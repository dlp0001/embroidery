import { one, query } from './db';
import { tellCampChanges } from './notify';
import { nowHM, plusDays, todayISO } from './format';
import { payoutPlan } from './payouts';
import {
  askAgainTargets, askView, claimSend, digestWatchers, isConfigured, moneyMonthView,
  moneyWatchers, payoutSoonView, recordSent, releaseSend, send, sentAgoMin,
  teacherDayView, teacherSessionView, teacherToday, teachersInBot,
} from './telegram';

/**
 * Что пора отправить преподавателю: утренняя сводка и напоминание за час
 * до занятия.
 *
 * Живёт отдельно от роута, потому что зовут это из двух мест. Первое —
 * внешний пингер по расписанию, раз в четверть часа. Второе — открытие
 * журнала: бесплатные расписания врут (у GitHub Actions за первый день
 * вышло два запуска вместо двадцати семи), и полагаться на один триггер
 * нельзя. Оба ведут сюда, а отметки в tg_log не дают отправить дважды,
 * поэтому мешать друг другу они не могут.
 */
const DIGEST_AT = '07:30';

/** Докуда утром ещё уместно присылать сводку на день. */
const DIGEST_UNTIL = '12:00';

/** За сколько до начала напоминаем. Окно широкое: триггеры опаздывают. */
const AHEAD_FROM = 75;
const AHEAD_TO = 30;

/** Сводка ушла только что — напоминание по тому же занятию излишне. */
const AFTER_DIGEST_QUIET = 90;

/**
 * Деньги за месяц — воскресным утром. Раз в неделю и в один день: касса
 * меняется медленно, а сводка, приходящая каждый день, к третьему дню
 * перестаёт читаться. Окно до часу дня: тик бывает раз в четверть часа,
 * а в воскресенье до студии ещё надо дойти.
 */
const MONEY_AT = '10:00';
const MONEY_UNTIL = '13:00';

/**
 * Утреннее напоминание родителям, которые на сегодня не отметились.
 * Вечерний вопрос приходит в семь, когда день уже кончился; к утру про
 * него забывают, а Варе к обеду надо знать, на скольких готовить.
 */
const ASK_AM_AT = '09:40';
const ASK_AM_UNTIL = '12:00';

/**
 * Накануне выплаты Isracard. Утром: деньги приходят в течение дня, и
 * узнать о них лучше до того, как они пришли, а не после.
 */
const PAYOUT_AT = '09:40';
const PAYOUT_UNTIL = '13:00';

export type Force = 'day' | 'next' | 'money' | 'ask' | 'payout' | null;

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

  const watchers = await digestWatchers();
  const teachers = await teachersInBot();

  for (const teacher of teachers) {
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

        // Копия тому, кто смотрит за студией со стороны. Отдельной строкой
        // сверху: сводка обращается к Варе по имени, и без пометки копия
        // читалась бы как письмо не по адресу.
        const copy = `Копия сводки · ${teacher.name ?? 'преподаватель'}\n\n${view.text}`;
        for (const w of watchers) {
          if (w.chat_id === teacher.chat_id) continue;
          if (force !== 'day' && !(await claimSend(dayCampaign, w.chat_id))) continue;
          tried++;
          if (await send(Number(w.chat_id), copy)) {
            await recordSent(dayCampaign, w.chat_id, copy);
            sent.push(`копия сводки → ${w.name}`);
          } else {
            failed++;
            if (force !== 'day') await releaseSend(dayCampaign, w.chat_id);
          }
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

  // ── Деньги за месяц, воскресным утром ──
  // Идёт и Варе, и тому, кто смотрит со стороны: цифры одни и те же, и
  // обсуждать их проще, когда они пришли обоим в одно время.
  // ── Утром: кто сегодня так и не отметился ──
  const askDue = force
    ? force === 'ask'
    : now >= minutes(ASK_AM_AT) && now < minutes(ASK_AM_UNTIL);
  if (askDue) {
    // Вопрос один на день, даже когда занятий в нём два: ключ дневной.
    const asked = new Set<string>();
    for (const t of await askAgainTargets()) {
      if (asked.has(`${t.chat_id}|${t.held_on}`)) continue;
      asked.add(`${t.chat_id}|${t.held_on}`);
      const campaign = `ask-am:${t.held_on}`;
      if (force !== 'ask' && !(await claimSend(campaign, t.chat_id))) continue;
      const view = await askView(t.user_id, t.session_id);
      // Занятие отменили, пока мы собирались, — спрашивать не о чем.
      if (!view) continue;
      tried++;
      if (await send(Number(t.chat_id), view.text, view.keyboard, view.html)) {
        await recordSent(campaign, t.chat_id, view.text);
        sent.push(`напоминание → ${t.chat_id}`);
      } else {
        failed++;
        if (force !== 'ask') await releaseSend(campaign, t.chat_id);
      }
    }
  }

  // ── Накануне выплаты Isracard ──
  const payoutDue = force
    ? force === 'payout'
    : now >= minutes(PAYOUT_AT) && now < minutes(PAYOUT_UNTIL);
  if (payoutDue) {
    const tomorrow = plusDays(today, 1);
    const plan = await payoutPlan(today);
    const soon = plan.upcoming.find((p) => p.day === tomorrow)
      // Руками просим показать ближайшую: ждать дня выплаты, чтобы
      // проверить сообщение, неудобно.
      ?? (force === 'payout' ? plan.upcoming[0] : undefined);
    if (soon) {
      const campaign = `payout-soon:${soon.day}`;
      const view = payoutSoonView(soon);
      for (const who of await moneyWatchers()) {
        if (force !== 'payout' && !(await claimSend(campaign, who.chat_id))) continue;
        tried++;
        if (await send(Number(who.chat_id), view.text)) {
          await recordSent(campaign, who.chat_id, view.text);
          sent.push(`выплата → ${who.name}`);
        } else {
          failed++;
          if (force !== 'payout') await releaseSend(campaign, who.chat_id);
        }
      }
    }
  }

  const sunday = new Date(`${today}T00:00:00Z`).getUTCDay() === 0;
  const moneyDue = force
    ? force === 'money'
    : sunday && now >= minutes(MONEY_AT) && now < minutes(MONEY_UNTIL);
  if (moneyDue) {
    const campaign = `money-week:${today}`;
    // Выплаты Isracard видят админы: это деньги кассы, а не занятия.
    const admins = new Set((await moneyWatchers()).map((a) => a.chat_id));
    const seen = new Set<string>();
    for (const who of [...teachers, ...watchers]) {
      if (seen.has(who.chat_id)) continue;
      seen.add(who.chat_id);
      if (force !== 'money' && !(await claimSend(campaign, who.chat_id))) continue;
      const view = await moneyMonthView(who.name, admins.has(who.chat_id));
      tried++;
      if (await send(Number(who.chat_id), view.text)) {
        await recordSent(campaign, who.chat_id, view.text);
        sent.push(`деньги → ${who.name}`);
      } else {
        failed++;
        if (force !== 'money') await releaseSend(campaign, who.chat_id);
      }
    }
  }

  // Записи на смену — тем же тиком, но только по расписанию: руками
  // просят сводку на день или напоминание, а не отчёт по лагерю.
  if (!force) {
    const camp = await tellCampChanges();
    if (camp > 0) sent.push(`смена → ${camp} админ(ам)`);
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
