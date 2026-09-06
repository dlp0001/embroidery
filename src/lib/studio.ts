import type { PoolClient } from 'pg';
import { one, query, tx } from './db';
import { plural } from './format';
import { logMoneyIn } from './ledger';

export type AttendanceStatus = 'present' | 'absent' | 'sick' | 'trial';

export type PassType = { lessons: number; price: number; months: number };

const DEFAULT_PASS_TYPES: PassType[] = [
  { lessons: 4, price: 360, months: 1 },
  { lessons: 8, price: 680, months: 2 },
];

/** Цена абонемента задана отдельно: он дешевле, чем те же занятия по одному. */
export async function passTypes(): Promise<PassType[]> {
  const row = await one<{ value: string }>(
    `select value from settings where key = 'pass_types'`,
  );
  if (!row?.value) return DEFAULT_PASS_TYPES;
  try {
    const parsed = JSON.parse(row.value) as PassType[];
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : DEFAULT_PASS_TYPES;
  } catch {
    return DEFAULT_PASS_TYPES;
  }
}

export type Participant = {
  id: string;
  name: string;
  kind: 'self' | 'child';
};

export async function getSetting(key: string, fallback: string): Promise<string> {
  const row = await one<{ value: string }>('select value from settings where key = $1', [key]);
  return row?.value ?? fallback;
}

export async function lessonPrice(): Promise<{ amount: number; currency: string }> {
  const row = await one<{ amount: string | null; currency: string | null }>(
    `select max(value) filter (where key = 'studio_lesson_price') as amount,
            max(value) filter (where key = 'studio_currency') as currency
       from settings`,
  );
  return {
    amount: Number(row?.amount ?? 100),
    currency: row?.currency ?? 'ILS',
  };
}

/** Участники семьи: сам взрослый и его дети. */
export async function familyParticipants(userId: string): Promise<Participant[]> {
  return query<Participant>(
    `select p.id, coalesce(u.name, 'Я') as name, 'self' as kind
       from participants p join users u on u.id = p.user_id
      where p.user_id = $1
      union all
     select p.id, c.name, 'child' as kind
       from participants p
       join children c on c.id = p.child_id and c.archived_at is null
       join guardians g on g.child_id = c.id
      where g.user_id = $1
      order by kind desc, name`,
    [userId],
  );
}

/** Действующий абонемент с остатком; берём тот, что раньше истекает. */
async function pickPass(c: PoolClient, ownerId: string): Promise<string | null> {
  const { rows } = await c.query<{ id: string }>(
    `select p.id
       from passes p
      where p.owner_id = $1
        and p.valid_from <= current_date
        and (p.valid_to is null or p.valid_to >= current_date)
        and (select count(*) from charges ch where ch.pass_id = p.id) < p.lessons_total
      order by p.valid_to nulls last, p.created_at
      limit 1
      for update`,
    [ownerId],
  );
  return rows[0]?.id ?? null;
}

export type PayWay = 'none' | 'cash' | 'pass';

export type Mark = { participantId: string; status: AttendanceStatus; pay?: PayWay };

/**
 * Сохраняет журнал занятия. Деньги считаются здесь и только здесь:
 * присутствие заводит начисление, оно либо садится на абонемент,
 * либо остаётся долгом. Остальные статусы начисления снимают.
 */
export type SaveActor = { id: string };

export type SaveResult = {
  present: number;
  onPass: number;
  toDebt: number;
  cash: number;
  /** Сколько уже проведённых строк переписали: это видно в реестре. */
  changed: number;
};

type ChargeRow = {
  id: string;
  participant_id: string;
  owner_id: string;
  pass_id: string | null;
  payment_id: string | null;
};

/**
 * Сохраняет журнал занятия. Деньги считаются здесь и только здесь.
 *
 * Всё, что можно, делается пакетом: база в другом городе, и полсотни
 * последовательных запросов складывались в заметную паузу. Поэтому
 * начисления, владельцы и абонементы читаются разом, а отметки
 * записываются одним запросом.
 */
export async function saveAttendance(
  sessionId: string,
  marks: Mark[],
  actor: SaveActor,
): Promise<SaveResult> {
  const { amount, currency } = await lessonPrice();
  const ids = marks.map((m) => m.participantId);

  return tx(async (c) => {
    const stat: SaveResult = { present: 0, onPass: 0, toDebt: 0, cash: 0, changed: 0 };
    if (ids.length === 0) return stat;

    // 1. Что уже начислено по этому занятию.
    const charges = new Map<string, ChargeRow>();
    const { rows: existing } = await c.query<ChargeRow>(
      `select id, participant_id, owner_id, pass_id, payment_id
         from charges where session_id = $1 and participant_id = any($2::uuid[])
         for update`,
      [sessionId, ids],
    );
    for (const row of existing) charges.set(row.participant_id, row);

    // 2. Отметки — одним запросом на всех.
    await c.query(
      `insert into attendance (session_id, participant_id, status, marked_by)
       select $1, p, s, $4
         from unnest($2::uuid[], $3::text[]) as t(p, s)
       on conflict (session_id, participant_id)
       do update set status = excluded.status, marked_by = excluded.marked_by, marked_at = now()`,
      [sessionId, ids, marks.map((m) => m.status), actor.id],
    );

    // 3. Кому выставлять счёт: для взрослого он сам, для ребёнка опекун.
    const needOwner = marks
      .filter((m) => m.status === 'present' && !charges.has(m.participantId))
      .map((m) => m.participantId);
    const owners = new Map<string, string[]>();
    if (needOwner.length > 0) {
      const { rows } = await c.query<{ participant_id: string; owner_id: string }>(
        `select p.id as participant_id, coalesce(p.user_id, g.user_id) as owner_id
           from participants p
           left join guardians g on g.child_id = p.child_id
          where p.id = any($1::uuid[]) and coalesce(p.user_id, g.user_id) is not null
          order by p.id, g.user_id`,
        [needOwner],
      );
      for (const r of rows) {
        owners.set(r.participant_id, [...(owners.get(r.participant_id) ?? []), r.owner_id]);
      }
    }

    // 4. Свободные занятия в абонементах — тоже разом, с запасом на списание.
    //    Абонемент может понадобиться и там, где занятие уже посчитано:
    //    Варя вправе переставить оплату на абонемент задним числом.
    const candidates = [...new Set([
      ...[...owners.values()].flat(),
      ...marks
        .filter((m) => m.status === 'present')
        .map((m) => charges.get(m.participantId)?.owner_id)
        .filter((id): id is string => Boolean(id)),
    ])];
    const passes = new Map<string, { id: string; left: number }[]>();
    if (candidates.length > 0) {
      const { rows } = await c.query<{ id: string; owner_id: string; left: number }>(
        `select p.id, p.owner_id,
                p.lessons_total - (select count(*)::int from charges c where c.pass_id = p.id) as left
           from passes p
          where p.owner_id = any($1::uuid[])
            and p.valid_from <= current_date
            and (p.valid_to is null or p.valid_to >= current_date)
          order by p.valid_to nulls last, p.created_at
          for update`,
        [candidates],
      );
      for (const r of rows) {
        if (r.left > 0) passes.set(r.owner_id, [...(passes.get(r.owner_id) ?? []), { id: r.id, left: r.left }]);
      }
    }

    /** Занимает одно занятие в абонементе владельца, если оно там есть. */
    const takePass = (ownerId: string): string | null => {
      const list = passes.get(ownerId);
      if (!list || list.length === 0) return null;
      const pass = list[0];
      pass.left--;
      if (pass.left <= 0) list.shift();
      return pass.id;
    };

    /** Возвращает занятие в абонемент: в тот же заход его можно отдать другому. */
    const givePass = (ownerId: string, passId: string): void => {
      const list = passes.get(ownerId) ?? [];
      const pass = list.find((p) => p.id === passId);
      if (pass) pass.left++;
      else list.unshift({ id: passId, left: 1 });
      passes.set(ownerId, list);
    };

    for (const mark of marks) {
      let charge = charges.get(mark.participantId);
      const wasSettled = Boolean(charge && (charge.pass_id || charge.payment_id));
      if (wasSettled) stat.changed++;

      if (mark.status !== 'present') {
        if (charge) {
          const wasCash = await dropCashPayment(c, sessionId, mark.participantId, actor.id);
          const { rowCount } = await c.query(
            `delete from charges where id = $1 and payment_id is null`, [charge.id]);
          if (rowCount) {
            await logMoneyIn(c, {
              kind: 'charge_removed', actorId: actor.id, ownerId: charge.owner_id,
              participantId: mark.participantId, sessionId, chargeId: charge.id,
              amount, currency, note: wasCash ? 'снята отметка, оплата отменена' : 'снята отметка',
            });
          }
        }
        continue;
      }

      stat.present++;
      const way: PayWay = mark.pay ?? 'none';

      if (!charge) {
        const list = owners.get(mark.participantId) ?? [];
        if (list.length === 0) continue;
        // Владелец — тот, у кого есть свободный абонемент, иначе первый.
        const owner = list.find((o) => (passes.get(o)?.length ?? 0) > 0) ?? list[0];
        const passId = way === 'pass' ? takePass(owner) : null;
        const inserted = await c.query<ChargeRow>(
          `insert into charges (participant_id, session_id, owner_id, amount, currency, pass_id)
           values ($1, $2, $3, $4, $5, $6)
           returning id, participant_id, owner_id, pass_id, payment_id`,
          [mark.participantId, sessionId, owner, amount, currency, passId],
        );
        charge = inserted.rows[0];
        charges.set(mark.participantId, charge);
        await logMoneyIn(c, {
          kind: passId ? 'charge_on_pass' : 'charge_created',
          actorId: actor.id, ownerId: owner, participantId: mark.participantId,
          sessionId, chargeId: charge.id, passId, amount, currency,
          note: passId ? 'списано с абонемента' : 'занятие в долг',
        });
      }

      // Выбрали другой способ — занятие возвращается в абонемент.
      if (way !== 'pass' && charge.pass_id) {
        const freed = charge.pass_id;
        await c.query('update charges set pass_id = null where id = $1', [charge.id]);
        givePass(charge.owner_id, freed);
        charge = { ...charge, pass_id: null };
        await logMoneyIn(c, {
          kind: 'charge_off_pass', actorId: actor.id, ownerId: charge.owner_id,
          participantId: mark.participantId, sessionId, chargeId: charge.id,
          passId: freed, amount, currency, note: 'занятие возвращено в абонемент',
        });
      }

      // Наличные: заводим платёж.
      if (way === 'cash') {
        if (!charge.payment_id) {
          const pay = await c.query<{ id: string }>(
            `insert into payments (provider, user_id, amount, currency, status, purpose)
             values ('cash', $1, $2, $3, 'paid', 'studio_lesson') returning id`,
            [charge.owner_id, amount, currency],
          );
          await c.query('update charges set payment_id = $2 where id = $1', [charge.id, pay.rows[0].id]);
          charge = { ...charge, payment_id: pay.rows[0].id };
          await logMoneyIn(c, {
            kind: 'cash_taken', actorId: actor.id, ownerId: charge.owner_id,
            participantId: mark.participantId, sessionId, chargeId: charge.id,
            paymentId: pay.rows[0].id, amount, currency, note: 'оплачено наличными или переводом, 1 занятие',
          });
        }
        stat.cash++;
        continue;
      }

      // Оплату сняли: платёж убираем.
      if (charge.payment_id) {
        const wasCash = await dropCashPayment(c, sessionId, mark.participantId, actor.id);
        if (!wasCash) continue; // оплачено картой, руками не трогаем
        charge = { ...charge, payment_id: null };
      }

      if (way === 'pass' && !charge.pass_id) {
        const passId = takePass(charge.owner_id);
        if (passId) {
          await c.query('update charges set pass_id = $2 where id = $1', [charge.id, passId]);
          charge = { ...charge, pass_id: passId };
          await logMoneyIn(c, {
            kind: 'charge_on_pass', actorId: actor.id, ownerId: charge.owner_id,
            participantId: mark.participantId, sessionId, chargeId: charge.id,
            passId, amount, currency, note: 'списано с абонемента',
          });
        }
      }

      // Было проведено, стало «не оплачено» — это тоже движение денег.
      if (way === 'none' && wasSettled && !charge.pass_id && !charge.payment_id) {
        await logMoneyIn(c, {
          kind: 'charge_created', actorId: actor.id, ownerId: charge.owner_id,
          participantId: mark.participantId, sessionId, chargeId: charge.id,
          amount, currency, note: 'занятие переведено в долг',
        });
      }

      if (charge.pass_id) stat.onPass++;
      else stat.toDebt++;
    }

    await c.query(
      `update studio_sessions set status = 'done', closed_at = now() where id = $1`,
      [sessionId],
    );
    return stat;
  });
}

/** Убирает прямой платёж с начисления. Возвращает true, если он там был. */
async function dropCashPayment(
  c: PoolClient,
  sessionId: string,
  participantId: string,
  actorId: string,
): Promise<boolean> {
  const { rows } = await c.query<{ payment_id: string }>(
    `select ch.payment_id from charges ch
       join payments p on p.id = ch.payment_id
      where ch.session_id = $1 and ch.participant_id = $2 and p.provider = 'cash'`,
    [sessionId, participantId],
  );
  if (rows.length === 0) return false;
  await c.query('update charges set payment_id = null where session_id = $1 and participant_id = $2', [
    sessionId,
    participantId,
  ]);
  await logMoneyIn(c, {
    kind: 'cash_reverted', actorId, participantId, sessionId,
    paymentId: rows[0].payment_id, note: 'оплата отменена',
  });
  await c.query('delete from payments where id = $1', [rows[0].payment_id]);
  return true;
}

export type PassBalance = {
  id: string;
  lessons_total: number;
  used: number;
  left: number;
  valid_to: string | null;
};

export async function passBalances(ownerId: string): Promise<PassBalance[]> {
  return query<PassBalance>(
    `select p.id, p.lessons_total, p.valid_to::text,
            (select count(*)::int from charges ch where ch.pass_id = p.id) as used,
            p.lessons_total - (select count(*)::int from charges ch where ch.pass_id = p.id) as left
       from passes p
      where p.owner_id = $1
        and (p.valid_to is null or p.valid_to >= current_date)
      order by p.valid_to nulls last, p.created_at`,
    [ownerId],
  );
}

export type UnpaidCharge = {
  id: string;
  held_on: string;
  group_title: string;
  who: string;
  amount: string;
  currency: string;
  /** Родитель уже заявил, что заплатит напрямую, ждём подтверждения студии. */
  declared: boolean;
};

export async function unpaidCharges(ownerId: string): Promise<UnpaidCharge[]> {
  return query<UnpaidCharge>(
    `select ch.id, s.held_on::text, g.title as group_title, ch.amount::text, ch.currency,
            coalesce(c.name, u.name, 'Я') as who,
            exists (
              select 1 from payments pay
               where pay.provider = 'cash' and pay.status = 'pending'
                 and pay.purpose = 'studio_debt' and pay.user_id = ch.owner_id
                 and pay.raw -> 'charge_ids' ? ch.id::text
            ) as declared
       from charges ch
       join studio_sessions s on s.id = ch.session_id
       join studio_groups g on g.id = s.group_id
       join participants p on p.id = ch.participant_id
       left join children c on c.id = p.child_id
       left join users u on u.id = p.user_id
      where ch.owner_id = $1 and ch.pass_id is null and ch.payment_id is null
      order by s.held_on`,
    [ownerId],
  );
}

export type VisitRow = UnpaidCharge & { status: AttendanceStatus; state: string };

export async function visitHistory(userId: string): Promise<VisitRow[]> {
  return query<VisitRow>(
    `select coalesce(ch.id, a.session_id) as id, s.held_on::text, g.title as group_title,
            coalesce(c.name, u.name, 'Я') as who, a.status,
            coalesce(ch.amount::text, '0') as amount, coalesce(ch.currency, 'ILS') as currency,
            case
              when a.status = 'sick' then 'sick'
              when a.status = 'absent' then 'absent'
              when a.status = 'trial' then 'trial'
              when ch.pass_id is not null then 'pass'
              when ch.payment_id is not null then 'paid'
              else 'due'
            end as state
       from attendance a
       join studio_sessions s on s.id = a.session_id
       join studio_groups g on g.id = s.group_id
       join participants p on p.id = a.participant_id
       left join children c on c.id = p.child_id
       left join users u on u.id = p.user_id
       left join charges ch on ch.session_id = a.session_id and ch.participant_id = a.participant_id
      where p.user_id = $1
         or p.child_id in (select child_id from guardians where user_id = $1)
      order by s.held_on desc`,
    [userId],
  );
}

/**
 * Создаёт занятия групп на несколько недель вперёд. Зовётся с каждого
 * открытия экрана, поэтому чаще раза в час не работает: иначе на каждый
 * показ страницы уходил бы тяжёлый запрос.
 */
/**
 * Досоздаёт занятия по расписанию групп на несколько недель вперёд.
 * Только вперёд: раньше подсыпалось ещё и 28 дней назад, и удалённое
 * прошлое возвращалось само собой. Разовое занятие задним числом
 * добавляется руками в календаре.
 */
export async function ensureSessions(weeksAhead = 6): Promise<number> {
  const fresh = await one<{ recent: boolean }>(
    `select value::timestamptz > now() - interval '1 hour' as recent
       from settings where key = 'sessions_filled_at'`,
  );
  if (fresh?.recent) return 0;

  const rows = await query<{ n: string }>(
    `with made as (
       insert into studio_sessions (group_id, held_on)
       select g.id, d::date
         from studio_groups g
         cross join generate_series(current_date,
                                    current_date + ($1 || ' weeks')::interval,
                                    interval '1 day') d
        where g.active and extract(isodow from d) = g.weekday
        on conflict (group_id, held_on) do nothing
       returning 1
     ), stamp as (
       insert into settings (key, value) values ('sessions_filled_at', now()::text)
       on conflict (key) do update set value = excluded.value
     )
     select 1 as n from made`,
    [String(weeksAhead)],
  );
  return rows.length;
}

export type UpcomingRow = {
  session_id: string;
  held_on: string;
  starts_at: string;
  group_id: string;
  group_title: string;
  participant_id: string;
  who: string;
  booked: boolean;
};

export async function setBooking(
  sessionId: string,
  participantId: string,
  booked: boolean,
): Promise<void> {
  if (booked) {
    await query(
      `insert into bookings (session_id, participant_id, status) values ($1, $2, 'booked')
       on conflict (session_id, participant_id) do update set status = 'booked'`,
      [sessionId, participantId],
    );
  } else {
    await query(
      `update bookings set status = 'cancelled' where session_id = $1 and participant_id = $2`,
      [sessionId, participantId],
    );
  }
}

// ── Экран преподавателя ───────────────────────────────────

export type TeacherSession = {
  session_id: string;
  group_id: string;
  group_title: string;
  held_on: string;
  starts_at: string;
  status: string;
  people: number;
  marked: number;
};

/** Занятия преподавателя: сегодняшние и недавние незакрытые. */
export async function teacherSessions(teacherId: string | null): Promise<TeacherSession[]> {
  return query<TeacherSession>(
    `select s.id as session_id, g.id as group_id, g.title as group_title,
            s.held_on::text, g.starts_at::text, s.status,
            (select count(*)::int
               from participants p
              where ((g.audience = 'adults' and p.user_id is not null)
                  or (g.audience = 'kids' and p.child_id is not null))
                and (exists (select 1 from preferred_days pd
                              where pd.participant_id = p.id
                                and pd.weekday = extract(isodow from s.held_on)::int)
                  or exists (select 1 from bookings b
                              where b.session_id = s.id and b.participant_id = p.id
                                and b.status = 'booked'))) as people,
            (select count(*)::int from attendance a where a.session_id = s.id) as marked
       from studio_sessions s
       join studio_groups g on g.id = s.group_id
      where ($1::uuid is null or g.teacher_id = $1)
        and s.held_on = current_date
        and s.status <> 'cancelled'
      order by g.starts_at`,
    [teacherId],
  );
}

/** Ближайший день с занятиями впереди. Нужен, когда сегодня пусто. */
export async function nextSessions(teacherId: string | null): Promise<TeacherSession[]> {
  return query<TeacherSession>(
    `with soonest as (
       select min(s.held_on) as day
         from studio_sessions s
         join studio_groups g on g.id = s.group_id
        where ($1::uuid is null or g.teacher_id = $1)
          and s.held_on > current_date
          and s.status <> 'cancelled'
     )
     select s.id as session_id, g.id as group_id, g.title as group_title,
            s.held_on::text, g.starts_at::text, s.status,
            (select count(*)::int from participants p
              where ((g.audience = 'adults' and p.user_id is not null)
                  or (g.audience = 'kids' and p.child_id is not null))
                and exists (select 1 from preferred_days pd
                             where pd.participant_id = p.id and pd.weekday = g.weekday)) as people,
            (select count(*)::int from attendance a where a.session_id = s.id) as marked
       from studio_sessions s
       join studio_groups g on g.id = s.group_id
       join soonest on s.held_on = soonest.day
      where ($1::uuid is null or g.teacher_id = $1)
        and s.status <> 'cancelled'
      order by g.starts_at`,
    [teacherId],
  );
}

/** Занятия прошлых дней, которые так и не отметили. */
export async function unclosedBefore(teacherId: string | null): Promise<TeacherSession[]> {
  return query<TeacherSession>(
    `select s.id as session_id, g.id as group_id, g.title as group_title,
            s.held_on::text, g.starts_at::text, s.status,
            (select count(*)::int from participants p
              where ((g.audience = 'adults' and p.user_id is not null)
                  or (g.audience = 'kids' and p.child_id is not null))
                and exists (select 1 from preferred_days pd
                             where pd.participant_id = p.id and pd.weekday = g.weekday)) as people,
            0 as marked
       from studio_sessions s
       join studio_groups g on g.id = s.group_id
      where ($1::uuid is null or g.teacher_id = $1)
        and s.held_on < current_date
        and s.held_on > current_date - interval '30 days'
        and s.status <> 'cancelled'
        and not exists (select 1 from attendance a where a.session_id = s.id)
      order by s.held_on desc, g.starts_at`,
    [teacherId],
  );
}

export type RosterRow = {
  participant_id: string;
  who: string;
  owner_id: string | null;
  status: AttendanceStatus | null;
  has_pass: boolean;
  on_pass: boolean;
  paid: boolean;
  cash: boolean;
  booked: boolean;
  preferred: boolean;
  /** Деньги уже проведены: менять может только суперадмин. */
  locked: boolean;
};

export async function sessionRoster(sessionId: string): Promise<RosterRow[]> {
  return query<RosterRow>(
    `with ses as (
       select s.id, g.audience, extract(isodow from s.held_on)::int as dow
         from studio_sessions s join studio_groups g on g.id = s.group_id
        where s.id = $1
     ),
     /* В журнале все, кто подходит занятию по типу: дети на детское,
        взрослые на взрослое. Кого ждём, решают записи и дни, но это
        только порядок в списке, а не право быть в нём. */
     owned as (
       select p.id as participant_id,
              coalesce(ch.name, u.name, 'Я') as who,
              coalesce(p.user_id,
                       (select g.user_id from guardians g
                         where g.child_id = p.child_id order by g.user_id limit 1)) as owner_id
         from participants p
         cross join ses
         left join children ch on ch.id = p.child_id
         left join users u on u.id = p.user_id
        where ch.archived_at is null
          and ((ses.audience = 'adults' and p.user_id is not null)
            or (ses.audience = 'kids' and p.child_id is not null))
     )
     select o.participant_id, o.who, o.owner_id,
            a.status,
            coalesce((select count(*) from passes ps
                       where ps.owner_id = o.owner_id
                         and ps.valid_from <= current_date
                         and (ps.valid_to is null or ps.valid_to >= current_date)
                         and (select count(*) from charges c2 where c2.pass_id = ps.id) < ps.lessons_total
                     ) > 0, false) as has_pass,
            (c.pass_id is not null) as on_pass,
            (c.payment_id is not null) as paid,
            coalesce((select pay.provider = 'cash' from payments pay where pay.id = c.payment_id), false) as cash,
            (c.id is not null) as locked,
            coalesce(b.status = 'booked', false) as booked,
            exists (select 1 from preferred_days pd cross join ses
                     where pd.participant_id = o.participant_id and pd.weekday = ses.dow) as preferred
       from owned o
       left join attendance a on a.session_id = $1 and a.participant_id = o.participant_id
       left join charges c on c.session_id = $1 and c.participant_id = o.participant_id
       left join bookings b on b.session_id = $1 and b.participant_id = o.participant_id
      order by o.who`,
    [sessionId],
  );
}

export type SessionHead = {
  session_id: string;
  group_title: string;
  age_hint: string | null;
  held_on: string;
  starts_at: string;
  status: string;
  teacher_id: string | null;
};

export async function sessionHead(sessionId: string): Promise<SessionHead | null> {
  return one<SessionHead>(
    `select s.id as session_id, g.title as group_title, g.age_hint,
            s.held_on::text, g.starts_at::text, s.status, g.teacher_id
       from studio_sessions s join studio_groups g on g.id = s.group_id
      where s.id = $1`,
    [sessionId],
  );
}

export type Debtor = {
  owner_id: string;
  name: string | null;
  email: string;
  lessons: number;
  amount: string;
  currency: string;
  since: string;
  who: string;
};

export async function debtors(): Promise<Debtor[]> {
  return query<Debtor>(
    `select ch.owner_id, u.name, u.email,
            count(*)::int as lessons,
            sum(ch.amount)::text as amount,
            min(ch.currency) as currency,
            min(s.held_on)::text as since,
            string_agg(distinct coalesce(c.name, pu.name, 'сам'), ', ') as who
       from charges ch
       join users u on u.id = ch.owner_id
       join studio_sessions s on s.id = ch.session_id
       join participants p on p.id = ch.participant_id
       left join children c on c.id = p.child_id
       left join users pu on pu.id = p.user_id
      where ch.pass_id is null and ch.payment_id is null
      group by ch.owner_id, u.name, u.email
      order by sum(ch.amount) desc`,
  );
}

export async function groupsOverview(teacherId: string | null) {
  return query<{
    id: string; title: string; age_hint: string | null; weekday: number;
    starts_at: string; people: number; active_passes: number; audience: string;
  }>(
    `select g.id, g.title, g.age_hint, g.weekday, g.starts_at::text, g.audience,
            (select count(*)::int from participants p
              where ((g.audience = 'adults' and p.user_id is not null)
                  or (g.audience = 'kids' and p.child_id is not null))
                and exists (select 1 from preferred_days pd
                             where pd.participant_id = p.id and pd.weekday = g.weekday)) as people,
            (select count(distinct ps.id)::int
               from participants p
               left join guardians gd on gd.child_id = p.child_id
               join passes ps on ps.owner_id = coalesce(p.user_id, gd.user_id)
              where ((g.audience = 'adults' and p.user_id is not null)
                  or (g.audience = 'kids' and p.child_id is not null))
                and exists (select 1 from preferred_days pd
                             where pd.participant_id = p.id and pd.weekday = g.weekday)
                and (ps.valid_to is null or ps.valid_to >= current_date)
                and (select count(*) from charges c2 where c2.pass_id = ps.id) < ps.lessons_total
            ) as active_passes
       from studio_groups g
      where g.active and ($1::uuid is null or g.teacher_id = $1)
      order by g.weekday, g.starts_at`,
    [teacherId],
  );
}

// ── Расписание для родителя ───────────────────────────────

export type SlotRow = {
  session_id: string;
  held_on: string;
  starts_at: string;
  group_title: string;
  audience: 'kids' | 'adults';
  weekday: number;
  capacity: number | null;
  taken: number;
  participant_id: string;
  who: string;
  is_adult: boolean;
  booked: boolean;
  preferred: boolean;
};

/**
 * Занятия за период и для каждого — те члены семьи, кому оно подходит
 * по типу: на детское ходят дети, на взрослое взрослые.
 */
export async function slotsForUser(userId: string, from: string, to: string): Promise<SlotRow[]> {
  return query<SlotRow>(
    `select s.id as session_id, s.held_on::text, g.starts_at::text, g.title as group_title,
            g.audience, g.weekday, g.capacity,
            (select count(*)::int from bookings bb
              where bb.session_id = s.id and bb.status = 'booked') as taken,
            p.id as participant_id,
            coalesce(c.name, u.name, 'Я') as who,
            (p.user_id is not null) as is_adult,
            (b.id is not null and b.status = 'booked') as booked,
            (pd.weekday is not null) as preferred
       from studio_sessions s
       join studio_groups g on g.id = s.group_id and g.active
       join participants p
         on (g.audience = 'adults' and p.user_id is not null)
         or (g.audience = 'kids' and p.child_id is not null)
       left join children c on c.id = p.child_id
       left join users u on u.id = p.user_id
       left join bookings b on b.session_id = s.id and b.participant_id = p.id
       left join preferred_days pd on pd.participant_id = p.id and pd.weekday = g.weekday
      where (p.user_id = $1 or p.child_id in (select child_id from guardians where user_id = $1))
        and c.archived_at is null
        and s.held_on between $2::date and $3::date
        and s.status <> 'cancelled'
      order by s.held_on, g.starts_at, (p.user_id is not null) desc, who`,
    [userId, from, to],
  );
}

export type FamilyMember = {
  participant_id: string;
  child_id: string | null;
  who: string;
  is_adult: boolean;
  days: number[];
};

export async function familyWithDays(userId: string): Promise<FamilyMember[]> {
  return query<FamilyMember>(
    `select p.id as participant_id, p.child_id,
            coalesce(c.name, u.name, 'Я') as who,
            (p.user_id is not null) as is_adult,
            coalesce(array_agg(pd.weekday order by pd.weekday)
                     filter (where pd.weekday is not null), '{}') as days
       from participants p
       left join children c on c.id = p.child_id
       left join users u on u.id = p.user_id
       left join preferred_days pd on pd.participant_id = p.id
      where c.archived_at is null
        and (p.user_id = $1
             or p.child_id in (select child_id from guardians where user_id = $1))
      group by p.id, p.child_id, c.name, u.name
      order by (p.user_id is not null) desc, coalesce(c.name, u.name)`,
    [userId],
  );
}

export async function addChild(userId: string, name: string): Promise<void> {
  await tx(async (c) => {
    const { rows } = await c.query<{ id: string }>(
      'insert into children (name) values ($1) returning id',
      [name],
    );
    await c.query('insert into guardians (child_id, user_id) values ($1, $2)', [rows[0].id, userId]);
    await c.query('insert into participants (child_id) values ($1)', [rows[0].id]);
  });
}

export async function renameChild(userId: string, childId: string, name: string): Promise<void> {
  await query(
    `update children set name = $3
      where id = $2 and exists (select 1 from guardians g where g.child_id = $2 and g.user_id = $1)`,
    [userId, childId, name],
  );
}

export async function setPreferredDay(
  participantId: string,
  weekday: number,
  on: boolean,
): Promise<void> {
  if (on) {
    await query(
      `insert into preferred_days (participant_id, weekday) values ($1, $2)
       on conflict do nothing`,
      [participantId, weekday],
    );
  } else {
    await query('delete from preferred_days where participant_id = $1 and weekday = $2', [
      participantId,
      weekday,
    ]);
  }
}

// ── Управление расписанием ────────────────────────────────

export type GroupRow = {
  id: string;
  title: string;
  teacher_id: string | null;
  weekday: number;
  starts_at: string;
  duration_min: number;
  room: string | null;
  audience: 'kids' | 'adults';
  age_hint: string | null;
  capacity: number | null;
  active: boolean;
  people: number;
};

export async function allGroups(): Promise<GroupRow[]> {
  return query<GroupRow>(
    `select g.id, g.title, g.teacher_id, g.weekday, g.starts_at::text, g.duration_min,
            g.room, g.audience, g.age_hint, g.capacity, g.active,
            (select count(*)::int from participants p
              where ((g.audience = 'adults' and p.user_id is not null)
                  or (g.audience = 'kids' and p.child_id is not null))
                and exists (select 1 from preferred_days pd
                             where pd.participant_id = p.id and pd.weekday = g.weekday)) as people
       from studio_groups g
      order by g.active desc, g.weekday, g.starts_at`,
  );
}

export async function teachers(): Promise<{ id: string; name: string | null; email: string }[]> {
  return query(
    `select u.id, u.name, u.email
       from users u
      where exists (
        select 1 from user_roles r
         where r.user_id = u.id and r.role in ('teacher', 'admin', 'superadmin'))
      order by coalesce(u.name, u.email)`,
  );
}

export type GroupInput = {
  title: string;
  weekday: number;
  startsAt: string;
  durationMin: number;
  audience: 'kids' | 'adults';
  ageHint: string | null;
  capacity: number | null;
  room: string | null;
  teacherId: string | null;
};

export async function createGroup(input: GroupInput): Promise<string> {
  const row = await one<{ id: string }>(
    `insert into studio_groups
       (title, weekday, starts_at, duration_min, audience, age_hint, capacity, room, teacher_id)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id`,
    [input.title, input.weekday, input.startsAt, input.durationMin, input.audience,
     input.ageHint, input.capacity, input.room, input.teacherId],
  );
  return row!.id;
}

export async function updateGroup(id: string, input: GroupInput): Promise<void> {
  await query(
    `update studio_groups set title = $2, weekday = $3, starts_at = $4, duration_min = $5,
            audience = $6, age_hint = $7, capacity = $8, room = $9, teacher_id = $10
      where id = $1`,
    [id, input.title, input.weekday, input.startsAt, input.durationMin, input.audience,
     input.ageHint, input.capacity, input.room, input.teacherId],
  );
}

export async function setGroupActive(id: string, active: boolean): Promise<void> {
  await query('update studio_groups set active = $2 where id = $1', [id, active]);
}

export type CalendarSession = {
  session_id: string;
  group_id: string;
  group_title: string;
  held_on: string;
  starts_at: string;
  status: string;
  marked: number;
  people: number;
};

export async function sessionsInRange(from: string, to: string): Promise<CalendarSession[]> {
  return query<CalendarSession>(
    `select s.id as session_id, g.id as group_id, g.title as group_title,
            s.held_on::text, g.starts_at::text, s.status,
            (select count(*)::int from attendance a where a.session_id = s.id) as marked,
            (select count(*)::int from participants p
              where ((g.audience = 'adults' and p.user_id is not null)
                  or (g.audience = 'kids' and p.child_id is not null))
                and exists (select 1 from preferred_days pd
                             where pd.participant_id = p.id and pd.weekday = g.weekday)) as people
       from studio_sessions s
       join studio_groups g on g.id = s.group_id
      where s.held_on between $1::date and $2::date
      order by s.held_on, g.starts_at`,
    [from, to],
  );
}

/** Разовое занятие в произвольный день, вне обычного расписания группы. */
export async function addSession(groupId: string, heldOn: string): Promise<void> {
  await query(
    `insert into studio_sessions (group_id, held_on) values ($1, $2::date)
     on conflict (group_id, held_on) do update set status = 'planned'`,
    [groupId, heldOn],
  );
}

export async function setSessionStatus(id: string, status: 'planned' | 'cancelled'): Promise<void> {
  await query('update studio_sessions set status = $2 where id = $1', [id, status]);
}

/**
 * Пересобирает будущие занятия группы под её текущий день и время.
 * Прошлое и всё, где уже есть отметки или деньги, не трогает.
 */
export async function resyncGroupSessions(groupId: string, weeksAhead = 6): Promise<void> {
  await tx(async (c) => {
    await c.query(
      `delete from studio_sessions s
        where s.group_id = $1
          and s.held_on > current_date
          and not exists (select 1 from attendance a where a.session_id = s.id)
          and not exists (select 1 from charges ch where ch.session_id = s.id)`,
      [groupId],
    );
    await c.query(
      `insert into studio_sessions (group_id, held_on)
       select g.id, d::date
         from studio_groups g
         cross join generate_series(current_date, current_date + ($2 || ' weeks')::interval, interval '1 day') d
        where g.id = $1 and g.active and extract(isodow from d) = g.weekday
       on conflict (group_id, held_on) do nothing`,
      [groupId, String(weeksAhead)],
    );
  });
}

// ── Абонементы ────────────────────────────────────────────

export type PassOwner = { id: string; name: string | null; email: string; active_left: number };

/** Взрослые, кому можно продать абонемент: родители и взрослые ученики. */
export async function passOwners(): Promise<PassOwner[]> {
  return query<PassOwner>(
    `select u.id, u.name, u.email,
            coalesce((select sum(p.lessons_total - (select count(*) from charges c where c.pass_id = p.id))::int
                        from passes p
                       where p.owner_id = u.id
                         and (p.valid_to is null or p.valid_to >= current_date)), 0) as active_left
       from users u
      where exists (select 1 from guardians g where g.user_id = u.id)
         or exists (select 1 from user_roles r where r.user_id = u.id and r.role in ('parent', 'student'))
      order by coalesce(u.name, u.email)`,
  );
}

export type IssuePassInput = {
  ownerId: string;
  lessons: number;
  months: number;
  paid: 'cash' | 'transfer' | 'unpaid';
  coverDebt: boolean;
};

/**
 * Выдаёт абонемент. При оплате наличными или переводом сразу заводит
 * платёж. Если попросили, гасит уже накопленные неоплаченные занятия:
 * самые старые вперёд, пока хватает занятий в пакете.
 */
export async function issuePass(input: IssuePassInput, byUser: string): Promise<{ covered: number }> {
  const { amount, currency } = await lessonPrice();
  // Абонемент стоит своих денег; если пакет нестандартный, считаем по занятиям.
  const type = (await passTypes()).find((t) => t.lessons === input.lessons);
  const total = type ? type.price : amount * input.lessons;

  return tx(async (c) => {
    let paymentId: string | null = null;
    if (input.paid !== 'unpaid') {
      const pay = await c.query<{ id: string }>(
        `insert into payments (provider, user_id, amount, currency, status, purpose, raw)
         values ($1, $2, $3, $4, 'paid', 'studio_pass', $5) returning id`,
        [input.paid, input.ownerId, total, currency,
         JSON.stringify({ issued_by: byUser, lessons: input.lessons })],
      );
      paymentId = pay.rows[0].id;
    }

    const pass = await c.query<{ id: string }>(
      `insert into passes (owner_id, lessons_total, valid_from, valid_to, payment_id)
       values ($1, $2, current_date, current_date + ($3 || ' months')::interval, $4)
       returning id`,
      [input.ownerId, input.lessons, String(input.months), paymentId],
    );
    const passId = pass.rows[0].id;

    await logMoneyIn(c, {
      kind: 'pass_issued', actorId: byUser, ownerId: input.ownerId,
      passId, paymentId, amount: total, currency,
      note: `абонемент на ${input.lessons} ${plural(input.lessons, 'занятие', 'занятия', 'занятий')}, ${
        input.paid === 'cash' ? 'наличными' : input.paid === 'transfer' ? 'переводом' : 'не оплачен'
      }`,
      details: { lessons: input.lessons, months: input.months, paid: input.paid },
    });

    let covered = 0;
    if (input.coverDebt) {
      const debts = await c.query<{ id: string }>(
        `select ch.id from charges ch
           join studio_sessions s on s.id = ch.session_id
          where ch.owner_id = $1 and ch.pass_id is null and ch.payment_id is null
          order by s.held_on
          limit $2`,
        [input.ownerId, input.lessons],
      );
      for (const row of debts.rows) {
        await c.query('update charges set pass_id = $2 where id = $1', [row.id, passId]);
        await logMoneyIn(c, {
          kind: 'pass_covered_debt', actorId: byUser, ownerId: input.ownerId,
          chargeId: row.id, passId, amount, currency, note: 'старое занятие закрыто абонементом',
        });
        covered++;
      }
    }
    return { covered };
  });
}

export type PassRow = {
  id: string;
  owner_name: string | null;
  owner_email: string;
  lessons_total: number;
  left: number;
  valid_to: string | null;
  paid: string | null;
};

export async function allActivePasses(): Promise<PassRow[]> {
  return query<PassRow>(
    `select p.id, u.name as owner_name, u.email as owner_email, p.lessons_total,
            p.lessons_total - (select count(*)::int from charges c where c.pass_id = p.id) as left,
            p.valid_to::text,
            (select pay.provider from payments pay where pay.id = p.payment_id) as paid
       from passes p
       join users u on u.id = p.owner_id
      where p.valid_to is null or p.valid_to >= current_date
      order by p.valid_to nulls last, coalesce(u.name, u.email)`,
  );
}

// ── Люди: семьи, дети, состав групп ───────────────────────

export type FamilyChild = {
  child_id: string;
  participant_id: string;
  name: string;
  days: number[];
  archived: boolean;
};

export type Family = {
  user_id: string;
  participant_id: string | null;
  name: string | null;
  email: string;
  roles: string[];
  own_days: number[];
  children: FamilyChild[];
};

/** Все взрослые с детьми и составом групп. */
export async function families(): Promise<Family[]> {
  const rows = await query<Family>(
    `select u.id as user_id, u.name, u.email,
            (select p.id from participants p where p.user_id = u.id) as participant_id,
            coalesce((select array_agg(r.role order by r.role) from user_roles r
                       where r.user_id = u.id), '{}') as roles,
            coalesce((select array_agg(pd.weekday order by pd.weekday)
                        from preferred_days pd
                        join participants p on p.id = pd.participant_id
                       where p.user_id = u.id), '{}') as own_days,
            coalesce((
              select json_agg(json_build_object(
                       'child_id', ch.id,
                       'participant_id', p.id,
                       'name', ch.name,
                       'archived', ch.archived_at is not null,
                       'days', coalesce((select array_agg(pd.weekday order by pd.weekday)
                                           from preferred_days pd
                                          where pd.participant_id = p.id), '{}')
                     ) order by ch.archived_at nulls first, ch.name)
                from guardians g
                join children ch on ch.id = g.child_id
                left join participants p on p.child_id = ch.id
               where g.user_id = u.id), '[]') as children
       from users u
      where exists (select 1 from guardians g where g.user_id = u.id)
         or exists (select 1 from user_roles r where r.user_id = u.id
                     and r.role in ('parent', 'student'))
      order by coalesce(u.name, u.email)`,
  );
  return rows.map((r) => ({ ...r, children: r.children ?? [] }));
}

export async function createParent(email: string, name: string): Promise<string> {
  const row = await one<{ id: string }>(
    `insert into users (email, name) values ($1, $2)
     on conflict (email) do update set name = coalesce(excluded.name, users.name)
     returning id`,
    [email.trim().toLowerCase(), name.trim() || null],
  );
  await query(`insert into user_roles (user_id, role) values ($1, 'parent') on conflict do nothing`, [row!.id]);
  await query('insert into participants (user_id) values ($1) on conflict do nothing', [row!.id]);
  return row!.id;
}

export async function renameUser(userId: string, name: string): Promise<void> {
  await query('update users set name = $2 where id = $1', [userId, name.trim() || null]);
}

export async function addChildTo(userId: string, name: string): Promise<void> {
  await tx(async (c) => {
    const { rows } = await c.query<{ id: string }>(
      'insert into children (name) values ($1) returning id', [name.trim()]);
    await c.query('insert into guardians (child_id, user_id) values ($1, $2)', [rows[0].id, userId]);
    await c.query('insert into participants (child_id) values ($1)', [rows[0].id]);
  });
}

export async function renameChildById(childId: string, name: string): Promise<void> {
  await query('update children set name = $2 where id = $1', [childId, name.trim()]);
}

/** Убирает ребёнка совсем. Отметки и деньги держат его: тогда отказ. */
/**
 * Убирает ребёнка из списков. Если он ни разу не был на занятии и денег
 * за него не считали, запись стирается совсем. Если след уже есть, она
 * прячется: журналы и деньги прошлых занятий должны остаться правдой.
 */
export type RetireResult = { removed: boolean; name: string | null };

export async function retireChild(childId: string): Promise<RetireResult> {
  const row = await one<{ name: string; used: string }>(
    `select c.name,
            (select count(*) from attendance a
               join participants p on p.id = a.participant_id where p.child_id = c.id)
          + (select count(*) from charges ch
               join participants p on p.id = ch.participant_id where p.child_id = c.id)
          + (select count(*) from bookings b
               join participants p on p.id = b.participant_id where p.child_id = c.id) as used
       from children c where c.id = $1`,
    [childId],
  );
  if (!row) return { removed: false, name: null };

  if (Number(row.used) === 0) {
    await query('delete from children where id = $1', [childId]);
    return { removed: true, name: row.name };
  }
  await query('update children set archived_at = now() where id = $1 and archived_at is null',
    [childId]);
  return { removed: false, name: row.name };
}

/** Возвращает скрытого ребёнка обратно в списки. */
export async function restoreChild(childId: string): Promise<void> {
  await query('update children set archived_at = null where id = $1', [childId]);
}

/** Скрытые дети семьи: показываем отдельно, чтобы можно было вернуть. */
export async function archivedChildren(userId: string): Promise<{ child_id: string; name: string }[]> {
  return query<{ child_id: string; name: string }>(
    `select c.id as child_id, c.name
       from children c join guardians g on g.child_id = c.id
      where g.user_id = $1 and c.archived_at is not null
      order by c.name`,
    [userId],
  );
}


