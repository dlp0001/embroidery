import { one, query } from './db';
import { lessonPrice, passTypes } from './studio';

/**
 * Отчёт за месяц: что студия продала и сколько за это получила.
 *
 * Считаем по дате события, а не по дате денег: занятие попадает в месяц,
 * когда оно случилось, абонемент — когда его купили. Так строка отчёта
 * сходится с тем, что Варя помнит про этот месяц.
 *
 * Занятие, закрытое абонементом, продажей не считается: деньги за него
 * пришли раньше, когда абонемент покупали. Такие занятия показываем
 * отдельно, чтобы они не пропали из виду.
 */
export type Cell = { count: number; sum: number };
export type StatsRow = { key: PayKind; label: string; lessons: Cell; passes: Cell };
export type PayKind = 'direct' | 'card' | 'due';

export type MonthStats = {
  month: string;
  currency: string;
  rows: StatsRow[];
  /** Занятия, списанные с абонементов: их оплатили раньше. */
  onPass: number;
  /** Продано занятий в абонементах: за них деньги уже взяты. */
  passLessons: number;
};

type LessonAgg = {
  cash_n: number; cash_sum: string;
  card_n: number; card_sum: string;
  due_n: number; due_sum: string;
  pass_n: number;
};

type PassRow = {
  id: string;
  lessons_total: number;
  provider: string | null;
  amount: string | null;
};

export async function monthStats(month: string): Promise<MonthStats> {
  const first = `${month}-01`;
  const [price, types] = await Promise.all([lessonPrice(), passTypes()]);

  const lessons = await one<LessonAgg>(
    `select
       count(*) filter (where pay.provider = 'cash')::int as cash_n,
       coalesce(sum(ch.amount) filter (where pay.provider = 'cash'), 0)::text as cash_sum,
       count(*) filter (where pay.provider is not null and pay.provider <> 'cash')::int as card_n,
       coalesce(sum(ch.amount) filter (where pay.provider is not null and pay.provider <> 'cash'), 0)::text as card_sum,
       count(*) filter (where ch.payment_id is null and ch.pass_id is null)::int as due_n,
       coalesce(sum(ch.amount) filter (where ch.payment_id is null and ch.pass_id is null), 0)::text as due_sum,
       count(*) filter (where ch.pass_id is not null)::int as pass_n
     from charges ch
     join studio_sessions s on s.id = ch.session_id
     left join payments pay on pay.id = ch.payment_id
    where s.held_on >= $1::date and s.held_on < ($1::date + interval '1 month')`,
    [first],
  );

  const passes = await query<PassRow>(
    `select ps.id, ps.lessons_total, pay.provider, pay.amount::text
       from passes ps
       left join payments pay on pay.id = ps.payment_id
      where ps.created_at >= $1::date
        and ps.created_at < ($1::date + interval '1 month')`,
    [first],
  );

  /** Сколько абонемент стоил. У неоплаченного цены нет — берём из справочника. */
  const worth = (p: PassRow): number => {
    if (p.amount !== null) return Number(p.amount);
    const t = types.find((x) => x.lessons === p.lessons_total);
    return t ? t.price : price.amount * p.lessons_total;
  };

  const bucket = (p: PassRow): PayKind =>
    p.provider === null ? 'due' : p.provider === 'cash' || p.provider === 'transfer' ? 'direct' : 'card';

  const cell = (kind: PayKind): Cell => {
    const mine = passes.filter((p) => bucket(p) === kind);
    return { count: mine.length, sum: mine.reduce((s, p) => s + worth(p), 0) };
  };

  const L = lessons ?? {
    cash_n: 0, cash_sum: '0', card_n: 0, card_sum: '0',
    due_n: 0, due_sum: '0', pass_n: 0,
  };

  return {
    month,
    currency: price.currency,
    onPass: L.pass_n,
    passLessons: passes.reduce((s, p) => s + p.lessons_total, 0),
    rows: [
      {
        key: 'direct',
        label: 'Наличными или переводом',
        lessons: { count: L.cash_n, sum: Number(L.cash_sum) },
        passes: cell('direct'),
      },
      {
        key: 'card',
        label: 'Картой',
        lessons: { count: L.card_n, sum: Number(L.card_sum) },
        passes: cell('card'),
      },
      {
        key: 'due',
        label: 'Не оплачено',
        lessons: { count: L.due_n, sum: Number(L.due_sum) },
        passes: cell('due'),
      },
    ],
  };
}

/** Месяцы, в которых вообще что-то происходило: для переключателя. */
export async function monthsWithData(): Promise<string[]> {
  const rows = await query<{ m: string }>(
    `select to_char(d, 'YYYY-MM') as m from (
       select date_trunc('month', s.held_on) as d
         from charges ch join studio_sessions s on s.id = ch.session_id
       union
       select date_trunc('month', ps.created_at) from passes ps
     ) t order by d desc`,
  );
  return rows.map((r) => r.m);
}
