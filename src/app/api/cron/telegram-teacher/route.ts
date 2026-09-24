import { nowHM, todayISO } from '@/lib/format';
import {
  claimSend, isConfigured, recordSent, releaseSend, send, sentAgoMin,
  teacherDayView, teacherSessionView, teacherToday, teachersInBot,
} from '@/lib/telegram';

export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

/**
 * Сообщения преподавателю: утренняя сводка на день и напоминание за час
 * до занятия.
 *
 * Зовётся снаружи каждые полчаса (см. .github/workflows/telegram-teacher.yml)
 * и сам решает, что сейчас пора. Почему не расписанием Vercel: на Hobby
 * задание запускается раз в сутки и может сработать в любой момент своего
 * часа, а «за час до» так не сделать — сообщение придёт после занятия.
 * Здесь же время считается по часам студии, поэтому переход на зимнее
 * время ничего не ломает.
 */
const DIGEST_AT = '07:30';

/** За сколько до начала напоминаем. Окно широкое: внешний крон опаздывает. */
const AHEAD_FROM = 75;
const AHEAD_TO = 30;

/** «Не повторяй сводку»: если она ушла только что, напоминание излишне. */
const AFTER_DIGEST_QUIET = 90;

function allowed(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get('authorization') === `Bearer ${secret}`;
}

function minutes(hm: string): number {
  const [h, m] = hm.split(':').map(Number);
  return h * 60 + m;
}

export async function GET(req: Request): Promise<Response> {
  if (!allowed(req)) {
    console.error('cron-teacher: вызов без секрета');
    return Response.json({ error: 'forbidden' }, { status: 401 });
  }
  if (!isConfigured()) return Response.json({ skipped: 'бот не настроен' });

  const force = new URL(req.url).searchParams.get('force');
  const today = todayISO();
  const now = minutes(nowHM().hhmm);
  const done: string[] = [];
  let tried = 0;
  let failed = 0;

  for (const teacher of await teachersInBot()) {
    const sessions = await teacherToday(teacher.id);

    // ── Сводка на день ──
    const dayCampaign = `teach-day:${today}`;
    // Попросили руками — делаем ровно то, что попросили. Иначе «пришли
    // напоминание» в половине восьмого прислало бы заодно и сводку,
    // потому что её окно в этот момент открыто.
    const dayDue = force
      ? force === 'day'
      : now >= minutes(DIGEST_AT) && now < minutes('12:00');
    // Пустой день пропускаем: «сегодня занятий нет» каждое утро — шум.
    // Руками спросили — отвечаем всё равно.
    if (dayDue && (sessions.length > 0 || force === 'day')) {
      const fresh = force === 'day' || await claimSend(dayCampaign, teacher.chat_id);
      if (fresh) {
        const view = await teacherDayView(teacher.id, teacher.name);
        tried++;
        if (await send(Number(teacher.chat_id), view.text)) {
          await recordSent(dayCampaign, teacher.chat_id, view.text);
          done.push(`сводка → ${teacher.name}`);
        } else {
          failed++;
          if (force !== 'day') await releaseSend(dayCampaign, teacher.chat_id);
        }
      }
    }

    // ── За час до занятия ──
    const soon = force
      ? (force === 'next'
        ? sessions.filter((s) => minutes(s.starts_at.slice(0, 5)) > now).slice(0, 1)
        : [])
      : sessions.filter((s) => {
        const left = minutes(s.starts_at.slice(0, 5)) - now;
        return left <= AHEAD_FROM && left >= AHEAD_TO;
      });

    for (const s of soon) {
      const campaign = `teach-ses:${s.session_id}`;
      if (force !== 'next') {
        // Сводка ушла только что и это занятие в ней уже было — хватит.
        const ago = await sentAgoMin(dayCampaign, teacher.chat_id);
        if (ago !== null && ago < AFTER_DIGEST_QUIET) continue;
        if (!(await claimSend(campaign, teacher.chat_id))) continue;
      }
      const view = await teacherSessionView(s.session_id, teacher.name);
      if (!view) continue;
      tried++;
      if (await send(Number(teacher.chat_id), view.text)) {
        await recordSent(campaign, teacher.chat_id, view.text);
        done.push(`за час → ${teacher.name}, ${s.group_title}`);
      } else {
        failed++;
        if (force !== 'next') await releaseSend(campaign, teacher.chat_id);
      }
    }
  }

  console.log(`cron-teacher: ${nowHM().hhmm}, попыток ${tried}, отправлено ${done.length}`, done);
  // tried отделяет «не пора» от «пора, но не ушло»: без него пустой ответ
  // читается одинаково в обоих случаях.
  return Response.json({ at: nowHM().hhmm, force, tried, failed, sent: done });
}
