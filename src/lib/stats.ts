import { one, query } from './db';
import { lessonPrice, passTypes } from './studio';

/**
 * Отчёт за выбранные дни: что студия продала и сколько за это получила.
 *
 * Считаем по дате события, а не по дате денег: занятие попадает в тот
 * день, когда оно прошло, абонемент — когда его купили. Так строка
 * отчёта сходится с тем, что Варя помнит про эти дни.
 *
 * Занятие, закрытое абонементом, продажей не считается: деньги за него
 * пришли раньше, когда абонемент покупали. Такие занятия показываем
 * отдельно, чтобы они не пропали из виду.
 */
export type Cell = { count: number; sum: number };
export type StatsRow = { key: PayKind; label: string; lessons: Cell; passes: Cell };
export type PayKind = 'direct' | 'card' | 'due';

export type PeriodStats = {
  from: string;
  to: string;
  currency: string;
  rows: StatsRow[];
  /** Занятия, списанные с абонементов: их оплатили раньше. */
  onPass: number;
  /** Продано занятий в абонементах: за них деньги уже взяты. */
  passLessons: number;
  /** Что студия за месяц отработала, независимо от того, когда платили. */
  done: Done;
};

/**
 * Реализация: занятия, которые прошли в этом месяце, и сколько они стоят.
 * Разовое стоит столько, сколько за него начислено. Занятие по абонементу
 * — свою долю от цены абонемента: восьмёрка за 680 даёт 85 за занятие,
 * а не сотню. День лагеря считается так же, но от своей цены и своего
 * пакета, поэтому лежит отдельной строкой: смешивать сотню с тремястами
 * тридцатью значит не понимать ни одной цифры.
 */
export type DoneRow = { count: number; sum: number };
export type Done = {
  /** Обычные занятия, оплаченные поштучно. */
  single: DoneRow;
  /** Обычные занятия, списанные с абонемента. */
  pass: DoneRow;
  /** Дни лагеря и мастер-классов, оплаченные поштучно. */
  event: DoneRow;
  /** Дни лагеря, списанные с пакета. */
  eventPass: DoneRow;
  /** Подаренные занятия: прошли, но денег за них нет. */
  gift: DoneRow;
  total: DoneRow;
  average: number;
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
  /** Цена пакета из его же группы: у лагеря она своя. */
  offer_price: string | null;
};

/**
 * Цена пакета, записанная в группе. Нужна, когда пакет выдан без оплаты:
 * брать для лагеря студийную цену занятия было бы просто неправдой.
 */
const OFFER_PRICE = `
  (select (o->>'price')::numeric
     from studio_groups og, jsonb_array_elements(og.pass_offers) o
    where og.id = ps.group_id and (o->>'lessons')::int = ps.lessons_total
    limit 1)`;

/**
 * Сколько за пакет заплатили всего: покупка плюс докупленные дни. Без
 * второго слагаемого день по продлённому пакету считался бы по старой
 * цене, размазанной на большее число дней.
 */
const PASS_PAID = `
  (coalesce(pay.amount, 0)
   + coalesce((select sum(ep.amount) from payments ep
                where ep.status = 'paid' and ep.raw ->> 'extends_pass' = ps.id::text), 0))`;

export async function periodStats(from: string, to: string): Promise<PeriodStats> {
  const [price, types] = await Promise.all([lessonPrice(), passTypes()]);

  const lessons = await one<LessonAgg>(
    `select
       /* «Нал / перевод» — всё, что Варя приняла сама: наличные, перевод,
          биток, пейбокс. Картой считается только то, что прошло кассу. */
       count(*) filter (where pay.provider in ('cash', 'transfer'))::int as cash_n,
       coalesce(sum(ch.amount) filter (where pay.provider in ('cash', 'transfer')), 0)::text as cash_sum,
       count(*) filter (where pay.provider is not null
                          and pay.provider not in ('cash', 'transfer', 'gift'))::int as card_n,
       coalesce(sum(ch.amount) filter (where pay.provider is not null
                          and pay.provider not in ('cash', 'transfer', 'gift')), 0)::text as card_sum,
       count(*) filter (where ch.payment_id is null and ch.pass_id is null)::int as due_n,
       coalesce(sum(ch.amount) filter (where ch.payment_id is null and ch.pass_id is null), 0)::text as due_sum,
       count(*) filter (where ch.pass_id is not null)::int as pass_n
     from charges ch
     join studio_sessions s on s.id = ch.session_id
     left join payments pay on pay.id = ch.payment_id
    where s.held_on between $1::date and $2::date`,
    [from, to],
  );

  // Реализация считается по занятиям месяца, а не по платежам.
  const delivered = await query<{
    pass_id: string | null; amount: string; kind: string;
    lessons_total: number | null; pass_paid: string | null; gift: boolean;
  }>(
    `select ch.pass_id, ch.amount::text, g.kind, ps.lessons_total,
            coalesce(nullif(${PASS_PAID}, 0), ${OFFER_PRICE})::text as pass_paid,
            coalesce(own.provider = 'gift', false) as gift
       from charges ch
       join studio_sessions s on s.id = ch.session_id
       join studio_groups g on g.id = s.group_id
       left join passes ps on ps.id = ch.pass_id
       left join payments pay on pay.id = ps.payment_id
       left join payments own on own.id = ch.payment_id
      where s.held_on between $1::date and $2::date`,
    [from, to],
  );

  const passes = await query<PassRow>(
    `select ps.id, ps.lessons_total, pay.provider, pay.amount::text,
            ${OFFER_PRICE}::text as offer_price
       from passes ps
       left join payments pay on pay.id = ps.payment_id
      where ps.created_at >= $1::date
        and ps.created_at < ($2::date + 1)`,
    [from, to],
  );

  // Докупленные дни — продажа того месяца, когда за них заплатили, и
  // считаются вместе с абонементами: это и есть пополнение пакета.
  const extras = await query<{ provider: string | null; amount: string; days: number }>(
    `select pay.provider, pay.amount::text, coalesce((pay.raw ->> 'days')::int, 0) as days
       from payments pay
      where pay.raw ? 'extends_pass'
        and pay.status = 'paid'
        and pay.created_at >= $1::date
        and pay.created_at < ($2::date + 1)`,
    [from, to],
  );

  /** Сколько абонемент стоил. У неоплаченного цены нет — берём из справочника. */
  const worth = (p: PassRow): number => {
    if (p.amount !== null) return Number(p.amount);
    if (p.offer_price !== null) return Number(p.offer_price);
    const t = types.find((x) => x.lessons === p.lessons_total);
    return t ? t.price : price.amount * p.lessons_total;
  };

  const bucket = (p: PassRow): PayKind =>
    p.provider === null ? 'due' : p.provider === 'cash' || p.provider === 'transfer' ? 'direct' : 'card';

  const cell = (kind: PayKind): Cell => {
    const mine = passes.filter((p) => bucket(p) === kind);
    const grown = extras.filter(
      (e) => (e.provider === null ? 'due'
        : e.provider === 'cash' || e.provider === 'transfer' ? 'direct' : 'card') === kind,
    );
    return {
      count: mine.length + grown.length,
      sum: mine.reduce((s, p) => s + worth(p), 0)
        + grown.reduce((s, e) => s + Number(e.amount), 0),
    };
  };

  const L = lessons ?? {
    cash_n: 0, cash_sum: '0', card_n: 0, card_sum: '0',
    due_n: 0, due_sum: '0', pass_n: 0,
  };

  const single: DoneRow = { count: 0, sum: 0 };
  const onPass: DoneRow = { count: 0, sum: 0 };
  const event: DoneRow = { count: 0, sum: 0 };
  const onEventPass: DoneRow = { count: 0, sum: 0 };
  const gift: DoneRow = { count: 0, sum: 0 };

  for (const d of delivered) {
    const camp = d.kind !== 'lesson';
    // Подарок стоит ноль, и в средней цене занятия ему делать нечего:
    // он занизил бы её тем сильнее, чем щедрее была студия.
    if (d.gift) {
      gift.count++;
      continue;
    }
    if (!d.pass_id) {
      const row = camp ? event : single;
      row.count++;
      row.sum += Number(d.amount);
      continue;
    }
    const lessons = d.lessons_total ?? 0;
    const paid = d.pass_paid !== null
      ? Number(d.pass_paid)
      : (types.find((t) => t.lessons === lessons)?.price ?? price.amount * lessons);
    const row = camp ? onEventPass : onPass;
    row.count++;
    row.sum += lessons > 0 ? paid / lessons : 0;
  }

  const parts = [single, onPass, event, onEventPass];
  const totalDone: DoneRow = {
    count: parts.reduce((n, r) => n + r.count, 0),
    sum: parts.reduce((n, r) => n + r.sum, 0),
  };

  return {
    from,
    to,
    currency: price.currency,
    done: {
      single,
      pass: onPass,
      event,
      eventPass: onEventPass,
      gift,
      total: totalDone,
      average: totalDone.count > 0 ? totalDone.sum / totalDone.count : 0,
    },
    onPass: L.pass_n,
    passLessons: passes.reduce((s, p) => s + p.lessons_total, 0)
      + extras.reduce((s, e) => s + e.days, 0),
    rows: [
      {
        key: 'direct',
        label: 'Нал / перевод',
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

// ── Отчёт по смене ────────────────────────────────────────

export type CampDay = {
  held_on: string;
  /** Пришли: отметка «был» или «пробное». */
  came: number;
  /** Записаны: нужно для дней, которые ещё впереди. */
  booked: number;
  /** Деньги этого дня: поштучные начисления плюс доли пакетов. */
  sum: number;
  /** День уже прошёл: у будущего считать посещаемость не из чего. */
  past: boolean;
};

export type CampStats = {
  id: string;
  title: string;
  currency: string;
  starts_on: string | null;
  ends_on: string | null;
  capacity: number | null;
  /** Цена разового дня. */
  dayPrice: number;
  days: CampDay[];
  /** Реализация: дни поштучно и дни по пакетам — как на статистике. */
  done: { single: DoneRow; pass: DoneRow; gift: DoneRow; total: DoneRow; average: number };
  /** Как оплачено: те же три строки, что в месячном отчёте. */
  rows: StatsRow[];
  /** Проданные пакеты этой смены. */
  packs: { count: number; days: number; sum: number };
  /** Докупленные в них дни. */
  extras: { count: number; days: number; sum: number };
  /** Сколько разных детей пришло хоть раз и сколько дней на каждого. */
  kids: number;
  perKid: number;
};

/**
 * Отчёт по одной смене целиком: от первого дня до последнего, независимо
 * от месяцев. Лагерь живёт на стыке сентября и октября, и месячный отчёт
 * разрезает его пополам — а вопрос «сколько заработала смена» задают про
 * смену, а не про календарь.
 *
 * Деньги считаются так же, как на статистике: разовый день стоит столько,
 * сколько за него начислено, день по пакету — свою долю от его цены.
 */
export async function campStats(groupId: string): Promise<CampStats | null> {
  const [price, group] = await Promise.all([
    lessonPrice(),
    one<{
      id: string; title: string; starts_on: string | null; ends_on: string | null;
      capacity: number | null; price: string | null;
    }>(
      `select id, title, starts_on::text, ends_on::text, capacity, price::text
         from studio_groups where id = $1 and kind <> 'lesson'`,
      [groupId],
    ),
  ]);
  if (!group) return null;

  const [days, delivered, packs, extras, kids] = await Promise.all([
    query<{ held_on: string; came: number; booked: number; past: boolean }>(
      `select s.held_on::text, s.held_on <= current_date as past,
              (select count(*)::int from attendance a
                where a.session_id = s.id and a.status in ('present', 'trial')) as came,
              (select count(*)::int from bookings b
                where b.session_id = s.id and b.status = 'booked') as booked
         from studio_sessions s
        where s.group_id = $1 and s.status <> 'cancelled'
        order by s.held_on`,
      [groupId],
    ),
    query<{
      held_on: string; pass_id: string | null; amount: string;
      lessons_total: number | null; pass_paid: string | null; gift: boolean;
    }>(
      `select s.held_on::text, ch.pass_id, ch.amount::text, ps.lessons_total,
              coalesce(nullif(${PASS_PAID}, 0), ${OFFER_PRICE})::text as pass_paid,
              coalesce(own.provider = 'gift', false) as gift
         from charges ch
         join studio_sessions s on s.id = ch.session_id
         left join passes ps on ps.id = ch.pass_id
         left join payments pay on pay.id = ps.payment_id
         left join payments own on own.id = ch.payment_id
        where s.group_id = $1`,
      [groupId],
    ),
    query<PassRow>(
      `select ps.id, ps.lessons_total, pay.provider, pay.amount::text,
              ${OFFER_PRICE}::text as offer_price
         from passes ps
         left join payments pay on pay.id = ps.payment_id
        where ps.group_id = $1`,
      [groupId],
    ),
    query<{ provider: string | null; amount: string; days: number }>(
      `select pay.provider, pay.amount::text,
              coalesce((pay.raw ->> 'days')::int, 0) as days
         from payments pay
        where pay.status = 'paid'
          and pay.raw ->> 'extends_pass' in (
                select ps.id::text from passes ps where ps.group_id = $1)`,
      [groupId],
    ),
    query<{ participant_id: string; n: number }>(
      `select a.participant_id, count(*)::int as n
         from attendance a
         join studio_sessions s on s.id = a.session_id
        where s.group_id = $1 and a.status in ('present', 'trial')
        group by a.participant_id`,
      [groupId],
    ),
  ]);

  // Как оплачены сами дни: те же три строки, что в месячном отчёте.
  const money = await one<LessonAgg>(
    `select
       count(*) filter (where pay.provider in ('cash', 'transfer'))::int as cash_n,
       coalesce(sum(ch.amount) filter (where pay.provider in ('cash', 'transfer')), 0)::text as cash_sum,
       count(*) filter (where pay.provider is not null
                          and pay.provider not in ('cash', 'transfer', 'gift'))::int as card_n,
       coalesce(sum(ch.amount) filter (where pay.provider is not null
                          and pay.provider not in ('cash', 'transfer', 'gift')), 0)::text as card_sum,
       count(*) filter (where ch.payment_id is null and ch.pass_id is null)::int as due_n,
       coalesce(sum(ch.amount) filter (where ch.payment_id is null and ch.pass_id is null), 0)::text as due_sum,
       count(*) filter (where ch.pass_id is not null)::int as pass_n
     from charges ch
     join studio_sessions s on s.id = ch.session_id
     left join payments pay on pay.id = ch.payment_id
    where s.group_id = $1`,
    [groupId],
  );

  /** Сколько стоил пакет: заплаченное, иначе цена из справочника смены. */
  const worth = (p: PassRow): number => Number(p.amount ?? p.offer_price ?? 0);

  const single: DoneRow = { count: 0, sum: 0 };
  const onPass: DoneRow = { count: 0, sum: 0 };
  const gift: DoneRow = { count: 0, sum: 0 };
  const byDay = new Map<string, number>();

  for (const d of delivered) {
    // Подарок в средней цене дня не участвует: он её только занижает.
    if (d.gift) {
      gift.count++;
      continue;
    }
    const share = d.pass_id
      ? (d.lessons_total && d.lessons_total > 0 ? Number(d.pass_paid ?? 0) / d.lessons_total : 0)
      : Number(d.amount);
    const row = d.pass_id ? onPass : single;
    row.count++;
    row.sum += share;
    byDay.set(d.held_on, (byDay.get(d.held_on) ?? 0) + share);
  }

  const total: DoneRow = {
    count: single.count + onPass.count,
    sum: single.sum + onPass.sum,
  };

  const cell = (kind: PayKind): Cell => {
    const mine = packs.filter((p) => (
      p.provider === null ? 'due' : p.provider === 'cash' || p.provider === 'transfer' ? 'direct' : 'card'
    ) === kind);
    const grown = extras.filter((e) => (
      e.provider === null ? 'due' : e.provider === 'cash' || e.provider === 'transfer' ? 'direct' : 'card'
    ) === kind);
    return {
      count: mine.length + grown.length,
      sum: mine.reduce((s, p) => s + worth(p), 0)
        + grown.reduce((s, e) => s + Number(e.amount), 0),
    };
  };

  const L = money ?? {
    cash_n: 0, cash_sum: '0', card_n: 0, card_sum: '0',
    due_n: 0, due_sum: '0', pass_n: 0,
  };
  const visits = kids.reduce((s, k) => s + k.n, 0);

  return {
    id: group.id,
    title: group.title,
    currency: price.currency,
    starts_on: group.starts_on,
    ends_on: group.ends_on,
    capacity: group.capacity,
    dayPrice: Number(group.price ?? price.amount),
    days: days.map((d) => ({
      held_on: d.held_on,
      came: d.came,
      booked: d.booked,
      past: d.past,
      sum: byDay.get(d.held_on) ?? 0,
    })),
    done: {
      single,
      pass: onPass,
      gift,
      total,
      average: total.count > 0 ? total.sum / total.count : 0,
    },
    rows: [
      {
        key: 'direct',
        label: 'Нал / перевод',
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
    packs: {
      count: packs.length,
      days: packs.reduce((s, p) => s + p.lessons_total, 0),
      sum: packs.reduce((s, p) => s + worth(p), 0),
    },
    extras: {
      count: extras.length,
      days: extras.reduce((s, e) => s + e.days, 0),
      sum: extras.reduce((s, e) => s + Number(e.amount), 0),
    },
    kids: kids.length,
    perKid: kids.length > 0 ? visits / kids.length : 0,
  };
}

/** Смены, по которым есть что показать: для выбора на странице отчёта. */
export async function campsWithData(): Promise<
  { id: string; title: string; starts_on: string | null; ends_on: string | null }[]
> {
  return query(
    `select g.id, g.title, g.starts_on::text, g.ends_on::text
       from studio_groups g
      where g.kind <> 'lesson'
        and exists (select 1 from studio_sessions s where s.group_id = g.id)
      order by g.starts_on desc nulls last`,
  );
}
