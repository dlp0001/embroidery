import { takenBetween } from './billing';
import { sales as courseSales, type Sales } from './course-admin';
import { one, query } from './db';
import { todayISO } from './format';
import { periodStats } from './stats';
import { debtors, teacherSessions } from './studio';

/**
 * Числа для мини-приложения: один экран, на который Варя и Дима смотрят
 * посреди дня. Ничего нового не считаем — всё это уже умеет студия,
 * здесь только собрано в одно место и в одну поездку в базу.
 *
 * Деньги те же, что в воскресной сводке: расхождение между экраном и
 * письмом было бы хуже, чем отсутствие экрана.
 */

const COURSE_SLUG = 'embroidery';

export type PulseSession = {
  title: string;
  at: string;
  /** Записались сами. */
  booked: number;
  /** Кого ждём: записанные плюс те, кто обычно ходит в этот день. */
  people: number;
  /** Сколько отмечено в журнале: ноль значит, что журнал ещё не вели. */
  marked: number;
  moved: boolean;
};

/** Строка в раскрытом блоке: подпись, сколько раз и сколько денег. */
export type Line = { label: string; count: number; sum: number };

export type Debt = { who: string; lessons: number; sum: number; since: string };

export type Pulse = {
  today: string;
  sessions: PulseSession[];
  money: {
    since: string;
    currency: string;
    taken: number;
    payments: number;
    lesson: number;
    camp: number;
    debtPeople: number;
    debtSum: number;
    /** Раскрытые блоки: чем платили, что из чего сложилось, кто должен. */
    takenBy: Line[];
    done: Line[];
    debts: Debt[];
  };
  course: { month: Sales; all: Sales };
  bot: {
    /** Сколько семей и взрослых учеников подключили бота из скольких. */
    inBot: number;
    people: number;
    /** Вопросы за месяц и ответы кнопкой на них. */
    asked: number;
    answered: number;
  };
  week: {
    /** Занятий прошло за неделю и сколько человек на них было. */
    lessons: number;
    visits: number;
    /** Записей сделано за неделю, из них через бота. */
    booked: number;
    viaBot: number;
  };
};

export async function pulse(): Promise<Pulse> {
  const today = todayISO();
  const from = `${today.slice(0, 7)}-01`;

  const [sessions, taken, done, debts, courseMonth, courseAll, counts, takenBy] =
    await Promise.all([
      teacherSessions(null, today),
      takenBetween(from, today),
      periodStats(from, today),
      debtors(),
      courseSales(COURSE_SLUG, from),
      courseSales(COURSE_SLUG, null),
      sideNumbers(),
      takenByWay(from, today),
    ]);

  const booked = await bookedBySession(sessions.map((s) => s.session_id));

  return {
    today,
    sessions: sessions.map((s) => ({
      title: s.group_title,
      at: s.starts_at.slice(0, 5),
      booked: booked.get(s.session_id) ?? 0,
      people: s.people,
      marked: s.marked,
      moved: s.moved,
    })),
    money: {
      since: from,
      currency: done.currency,
      taken: Math.round(taken.sum),
      payments: taken.count,
      lesson: Math.round(done.done.single.sum + done.done.pass.sum),
      camp: Math.round(done.done.event.sum + done.done.eventPass.sum),
      debtPeople: debts.length,
      debtSum: Math.round(debts.reduce((sum, d) => sum + Number(d.amount), 0)),
      takenBy,
      done: doneLines(done.done),
      debts: debts.map((d) => ({
        who: d.name ?? d.email,
        lessons: d.lessons,
        sum: Math.round(Number(d.amount)),
        since: d.since,
      })),
    },
    course: { month: courseMonth, all: courseAll },
    ...counts,
  };
}

/**
 * Чем платили за месяц. Отбор тот же, что у «Получено»: иначе строки
 * не сложились бы в показанную сверху сумму, и экран спорил бы сам с
 * собой. Способ берём из самого платежа: провайдер отвечает только на
 * вопрос, кто принял деньги, а не чем их отдали.
 */
async function takenByWay(from: string, to: string): Promise<Line[]> {
  const rows = await query<{ label: string; count: number; sum: string }>(
    `select case
              when p.raw ->> 'pay_method' = 'cash' then 'Наличными'
              when p.raw ->> 'pay_method' = 'bit' then 'Bit'
              when p.raw ->> 'pay_method' = 'paybox' then 'PayBox'
              when p.raw ->> 'pay_method' = 'transfer' then 'Переводом'
              when p.provider in ('cash', 'transfer') then 'Способ не записан'
              else 'Картой'
            end as label,
            count(*)::int as count, coalesce(sum(p.amount), 0)::text as sum
       from payments p
      where p.status = 'paid'
        and p.provider <> 'gift'
        and p.purpose is distinct from 'studio_test'
        and p.created_at >= $1::date
        and p.created_at < ($2::date + 1)
      group by 1
      order by sum(p.amount) desc`,
    [from, to],
  );
  return rows.map((r) => ({ label: r.label, count: r.count, sum: Math.round(Number(r.sum)) }));
}

/** Из чего сложилась реализация. Пустые строки не показываем. */
function doneLines(done: Awaited<ReturnType<typeof periodStats>>['done']): Line[] {
  return [
    { label: 'Занятия поштучно', ...cell(done.single) },
    { label: 'Занятия с абонемента', ...cell(done.pass) },
    { label: 'Лагерь поштучно', ...cell(done.event) },
    { label: 'Лагерь из пакета', ...cell(done.eventPass) },
    { label: 'Подарено', ...cell(done.gift) },
  ].filter((r) => r.count > 0);
}

function cell(row: { count: number; sum: number }): { count: number; sum: number } {
  return { count: row.count, sum: Math.round(row.sum) };
}

async function bookedBySession(ids: string[]): Promise<Map<string, number>> {
  if (ids.length === 0) return new Map();
  const rows = await query<{ session_id: string; n: number }>(
    `select session_id, count(*)::int as n from bookings
      where session_id = any($1::uuid[]) and status = 'booked'
      group by session_id`,
    [ids],
  );
  return new Map(rows.map((r) => [r.session_id, r.n]));
}

/**
 * Бот и неделя одним запросом: это пять счётчиков, и пять поездок в базу
 * ради них были бы расточительством.
 */
async function sideNumbers(): Promise<Pick<Pulse, 'bot' | 'week'>> {
  const row = await one<{
    in_bot: number; people: number; asked: number; answered: number;
    lessons: number; visits: number; booked: number; via_bot: number;
  }>(
    `select
       (select count(*)::int from users where tg_chat_id is not null) as in_bot,
       /* Кому бот вообще нужен: кто водит ребёнка или ходит сам. */
       (select count(*)::int from users u
         where u.attends
            or exists (select 1 from guardians g join children ch on ch.id = g.child_id
                        where g.user_id = u.id and ch.archived_at is null)) as people,
       (select count(*)::int from tg_log
         where sent_at > now() - interval '30 days'
           and (campaign like 'ask:%' or campaign like 'ask-am:%')) as asked,
       (select count(*)::int from bookings
         where changed_via = 'bot' and updated_at > now() - interval '30 days') as answered,
       (select count(*)::int from studio_sessions s
         where s.held_on between current_date - 7 and current_date
           and s.status <> 'cancelled') as lessons,
       (select count(*)::int from attendance a
          join studio_sessions s on s.id = a.session_id
         where s.held_on between current_date - 7 and current_date
           and a.status = 'present') as visits,
       (select count(*)::int from bookings
         where updated_at > now() - interval '7 days' and status = 'booked') as booked,
       (select count(*)::int from bookings
         where updated_at > now() - interval '7 days' and status = 'booked'
           and changed_via = 'bot') as via_bot`,
  );
  return {
    bot: {
      inBot: row?.in_bot ?? 0,
      people: row?.people ?? 0,
      asked: row?.asked ?? 0,
      answered: row?.answered ?? 0,
    },
    week: {
      lessons: row?.lessons ?? 0,
      visits: row?.visits ?? 0,
      booked: row?.booked ?? 0,
      viaBot: row?.via_bot ?? 0,
    },
  };
}
