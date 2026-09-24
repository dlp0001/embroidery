import { one, query } from './db';
import { nowHM, todayISO } from './format';
import {
  claimSend, isConfigured, recordSent, releaseSend, send, sentAgoMin,
  teacherDayView, teacherSessionView, teacherToday, teachersInBot,
} from './telegram';

/**
 * Что пора отправить преподавателю: утренняя сводка и напоминание за час
 * до занятия.
 *
 * Живёт отдельно от роута, потому что зовут это из двух мест. Первое —
 * внешний пингер по расписанию. Второе — открытие журнала: расписание
 * GitHub за первый день дало два запуска вместо двадцати семи, и полагаться
 * на один триггер нельзя. Оба ведут сюда, а отметки в tg_log не дают
 * отправить дважды, поэтому мешать друг другу они не могут.
 */
const DIGEST_AT = '07:30';

/** Докуда утром ещё уместно присылать сводку на день. */
const DIGEST_UNTIL = '12:00';

/** За сколько до начала напоминаем. Окно широкое: триггеры опаздывают. */
const AHEAD_FROM = 75;
const AHEAD_TO = 30;

/** Сводка ушла только что — напоминание по тому же занятию излишне. */
const AFTER_DIGEST_QUIET = 90;

export type Force = 'day' | 'next' | null;

export type DueResult = { at: string; tried: number; failed: number; sent: string[] };

function minutes(hm: string): number {
  const [h, m] = hm.split(':').map(Number);
  return h * 60 + m;
}

export async function sendDue(force: Force): Promise<DueResult> {
  const at = nowHM().hhmm;
  const now = minutes(at);
  const today = todayISO();
  const sent: string[] = [];
  let tried = 0;
  let failed = 0;
  if (!isConfigured()) return { at, tried, failed, sent };

  for (const teacher of await teachersInBot()) {
    const sessions = await teacherToday(teacher.id);

    // ── Сводка на день ──
    const dayCampaign = `teach-day:${today}`;
    // Попросили руками — делаем ровно то, что попросили. Иначе «пришли
    // напоминание» в половине восьмого прислало бы заодно и сводку,
    // потому что её окно в этот момент открыто.
    const dayDue = force
      ? force === 'day'
      : now >= minutes(DIGEST_AT) && now < minutes(DIGEST_UNTIL);
    // Пустой день пропускаем: «сегодня занятий нет» каждое утро — шум.
    // Руками спросили — отвечаем всё равно.
    if (dayDue && (sessions.length > 0 || force === 'day')) {
      const fresh = force === 'day' || await claimSend(dayCampaign, teacher.chat_id);
      if (fresh) {
        const view = await teacherDayView(teacher.id, teacher.name);
        tried++;
        if (await send(Number(teacher.chat_id), view.text)) {
          await recordSent(dayCampaign, teacher.chat_id, view.text);
          sent.push(`сводка → ${teacher.name}`);
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
        sent.push(`за час → ${teacher.name}, ${s.group_title}`);
      } else {
        failed++;
        if (force !== 'next') await releaseSend(campaign, teacher.chat_id);
      }
    }
  }

  console.log(`tg-due: ${at}, попыток ${tried}, отправлено ${sent.length}`, sent);
  return { at, tried, failed, sent };
}

/** Не чаще этого проверяем «что пора» на открытии страниц. */
const TICK_EVERY_MIN = 5;

/**
 * Проверка на попутном движении: журнал открывают в течение дня, и этого
 * хватает, чтобы сводка уходила даже когда внешний триггер молчит.
 *
 * Самоограничение через settings — тем же приёмом, что ensureSessions:
 * открытие страницы не должно каждый раз ходить по всем преподавателям.
 * Ошибку глотаем: рассылка не имеет права мешать открыть журнал.
 */
export async function tickOnTraffic(): Promise<void> {
  try {
    if (!isConfigured()) return;
    const fresh = await one<{ recent: boolean }>(
      `select value::timestamptz > now() - ($1 || ' minutes')::interval as recent
         from settings where key = 'tg_tick_at'`,
      [String(TICK_EVERY_MIN)]);
    if (fresh?.recent) return;
    await query(
      `insert into settings (key, value) values ('tg_tick_at', now()::text)
       on conflict (key) do update set value = excluded.value`);
    await sendDue(null);
  } catch (err) {
    console.error('tg-due: попутная проверка не прошла', err);
  }
}
