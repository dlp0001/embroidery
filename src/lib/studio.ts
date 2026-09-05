import type { PoolClient } from 'pg';
import { one, query, tx } from './db';

export type AttendanceStatus = 'present' | 'absent' | 'sick' | 'trial';

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
  const amount = Number(await getSetting('studio_lesson_price', '60'));
  const currency = await getSetting('studio_currency', 'ILS');
  return { amount, currency };
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
       join children c on c.id = p.child_id
       join guardians g on g.child_id = c.id
      where g.user_id = $1
      order by kind desc, name`,
    [userId],
  );
}

/**
 * Кому уходит счёт за посещение. Для взрослого это он сам, для ребёнка —
 * опекун. Если опекунов несколько, берём того, у кого есть свободный
 * абонемент; иначе первого.
 */
async function ownerFor(c: PoolClient, participantId: string): Promise<string | null> {
  const { rows } = await c.query<{ user_id: string }>(
    `select p.user_id from participants p where p.id = $1 and p.user_id is not null
      union all
     select g.user_id
       from participants p
       join guardians g on g.child_id = p.child_id
       join users u on u.id = g.user_id
      where p.id = $1
      order by 1`,
    [participantId],
  );
  if (rows.length === 0) return null;
  for (const r of rows) {
    if (await pickPass(c, r.user_id)) return r.user_id;
  }
  return rows[0].user_id;
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

export type Mark = { participantId: string; status: AttendanceStatus; cash?: boolean };

/**
 * Сохраняет журнал занятия. Деньги считаются здесь и только здесь:
 * присутствие заводит начисление, оно либо садится на абонемент,
 * либо остаётся долгом. Остальные статусы начисления снимают.
 */
export async function saveAttendance(
  sessionId: string,
  marks: Mark[],
  markedBy: string,
): Promise<{ present: number; onPass: number; toDebt: number; cash: number }> {
  const { amount, currency } = await lessonPrice();

  return tx(async (c) => {
    const stat = { present: 0, onPass: 0, toDebt: 0, cash: 0 };

    for (const mark of marks) {
      await c.query(
        `insert into attendance (session_id, participant_id, status, marked_by)
         values ($1, $2, $3, $4)
         on conflict (session_id, participant_id)
         do update set status = excluded.status, marked_by = excluded.marked_by, marked_at = now()`,
        [sessionId, mark.participantId, mark.status, markedBy],
      );

      if (mark.status !== 'present') {
        await dropCashPayment(c, sessionId, mark.participantId);
        await c.query(
          `delete from charges
            where session_id = $1 and participant_id = $2 and payment_id is null`,
          [sessionId, mark.participantId],
        );
        continue;
      }

      stat.present++;

      // Начисление заводим один раз, дальше только пересобираем оплату.
      const existing = await c.query<{ id: string; owner_id: string; pass_id: string | null; payment_id: string | null }>(
        'select id, owner_id, pass_id, payment_id from charges where session_id = $1 and participant_id = $2',
        [sessionId, mark.participantId],
      );

      let charge = existing.rows[0];
      if (!charge) {
        const owner = await ownerFor(c, mark.participantId);
        if (!owner) continue;
        const passId = mark.cash ? null : await pickPass(c, owner);
        const inserted = await c.query<{ id: string; owner_id: string; pass_id: string | null; payment_id: string | null }>(
          `insert into charges (participant_id, session_id, owner_id, amount, currency, pass_id)
           values ($1, $2, $3, $4, $5, $6)
           returning id, owner_id, pass_id, payment_id`,
          [mark.participantId, sessionId, owner, amount, currency, passId],
        );
        charge = inserted.rows[0];
      }

      if (mark.cash) {
        if (!charge.payment_id) {
          const pay = await c.query<{ id: string }>(
            `insert into payments (provider, user_id, amount, currency, status, purpose)
             values ('cash', $1, $2, $3, 'paid', 'studio_lesson') returning id`,
            [charge.owner_id, amount, currency],
          );
          await c.query('update charges set payment_id = $2, pass_id = null where id = $1', [
            charge.id,
            pay.rows[0].id,
          ]);
        }
        stat.cash++;
        continue;
      }

      // Наличные сняли — платёж убираем и заново смотрим на абонемент.
      if (charge.payment_id) {
        const wasCash = await dropCashPayment(c, sessionId, mark.participantId);
        if (wasCash) {
          const passId = await pickPass(c, charge.owner_id);
          await c.query('update charges set pass_id = $2 where id = $1', [charge.id, passId]);
          charge = { ...charge, pass_id: passId, payment_id: null };
        } else {
          continue; // оплачено картой, не трогаем
        }
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

/** Убирает наличный платёж с начисления. Возвращает true, если он там был. */
async function dropCashPayment(
  c: PoolClient,
  sessionId: string,
  participantId: string,
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
};

export async function unpaidCharges(ownerId: string): Promise<UnpaidCharge[]> {
  return query<UnpaidCharge>(
    `select ch.id, s.held_on::text, g.title as group_title, ch.amount::text, ch.currency,
            coalesce(c.name, u.name, 'Я') as who
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

/** Создаёт занятия группы на несколько недель вперёд. */
export async function ensureSessions(weeksAhead = 6): Promise<number> {
  const rows = await query<{ n: string }>(
    `with slots as (
       select g.id as group_id,
              (d::date) as held_on
         from studio_groups g
         cross join generate_series(current_date - interval '28 days',
                                    current_date + ($1 || ' weeks')::interval,
                                    interval '1 day') d
        where g.active
          and extract(isodow from d) = g.weekday
     )
     insert into studio_sessions (group_id, held_on)
     select group_id, held_on from slots
     on conflict (group_id, held_on) do nothing
     returning 1`,
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

export async function sessionsForUser(
  userId: string,
  from: string,
  to: string,
): Promise<UpcomingRow[]> {
  return query<UpcomingRow>(
    `select s.id as session_id, s.held_on::text, g.starts_at::text, g.id as group_id,
            g.title as group_title, p.id as participant_id,
            coalesce(c.name, u.name, 'Я') as who,
            (b.id is not null and b.status = 'booked') as booked
       from studio_members m
       join participants p on p.id = m.participant_id
       join studio_groups g on g.id = m.group_id
       join studio_sessions s on s.group_id = g.id
       left join children c on c.id = p.child_id
       left join users u on u.id = p.user_id
       left join bookings b on b.session_id = s.id and b.participant_id = p.id
      where (p.user_id = $1 or p.child_id in (select child_id from guardians where user_id = $1))
        and m.left_at is null
        and s.held_on >= $2::date and s.held_on <= $3::date
        and s.status <> 'cancelled'
      order by s.held_on, g.starts_at`,
    [userId, from, to],
  );
}

export async function upcomingForUser(userId: string, days = 7): Promise<UpcomingRow[]> {
  return query<UpcomingRow>(
    `select s.id as session_id, s.held_on::text, g.starts_at::text, g.id as group_id,
            g.title as group_title, p.id as participant_id,
            coalesce(c.name, u.name, 'Я') as who,
            (b.id is not null and b.status = 'booked') as booked
       from studio_members m
       join participants p on p.id = m.participant_id
       join studio_groups g on g.id = m.group_id
       join studio_sessions s on s.group_id = g.id
       left join children c on c.id = p.child_id
       left join users u on u.id = p.user_id
       left join bookings b on b.session_id = s.id and b.participant_id = p.id
      where (p.user_id = $1 or p.child_id in (select child_id from guardians where user_id = $1))
        and m.left_at is null
        and s.held_on >= current_date
        and s.held_on < current_date + ($2 || ' days')::interval
        and s.status <> 'cancelled'
      order by s.held_on, g.starts_at`,
    [userId, String(days)],
  );
}

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
            (select count(*)::int from studio_members m
              where m.group_id = g.id and m.left_at is null) as people,
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

/** Занятия прошлых дней, которые так и не отметили. */
export async function unclosedBefore(teacherId: string | null): Promise<TeacherSession[]> {
  return query<TeacherSession>(
    `select s.id as session_id, g.id as group_id, g.title as group_title,
            s.held_on::text, g.starts_at::text, s.status,
            (select count(*)::int from studio_members m
              where m.group_id = g.id and m.left_at is null) as people,
            0 as marked
       from studio_sessions s
       join studio_groups g on g.id = s.group_id
      where ($1::uuid is null or g.teacher_id = $1)
        and s.held_on < current_date
        and s.held_on > current_date - interval '30 days'
        and s.status <> 'cancelled'
        and not exists (select 1 from attendance a where a.session_id = s.id)
        and exists (select 1 from studio_members m where m.group_id = g.id and m.left_at is null)
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
};

export async function sessionRoster(sessionId: string): Promise<RosterRow[]> {
  return query<RosterRow>(
    `with roster as (
       select m.participant_id, p.child_id, p.user_id,
              coalesce(ch.name, u.name, 'Я') as who
         from studio_sessions s
         join studio_members m on m.group_id = s.group_id and m.left_at is null
         join participants p on p.id = m.participant_id
         left join children ch on ch.id = p.child_id
         left join users u on u.id = p.user_id
        where s.id = $1
     ),
     owned as (
       select r.*,
              coalesce(r.user_id,
                       (select g.user_id from guardians g
                         where g.child_id = r.child_id order by g.user_id limit 1)) as owner_id
         from roster r
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
            coalesce((select p.provider = 'cash' from payments p where p.id = c.payment_id), false) as cash,
            coalesce(b.status = 'booked', false) as booked,
            (pd.weekday is not null) as preferred
       from owned o
       cross join studio_sessions ss
       join studio_groups gg on gg.id = ss.group_id
       left join attendance a on a.session_id = $1 and a.participant_id = o.participant_id
       left join charges c on c.session_id = $1 and c.participant_id = o.participant_id
       left join bookings b on b.session_id = $1 and b.participant_id = o.participant_id
       left join preferred_days pd
              on pd.participant_id = o.participant_id and pd.weekday = gg.weekday
      where ss.id = $1
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
            (select count(*)::int from studio_members m where m.group_id = g.id and m.left_at is null) as people,
            (select count(distinct ps.id)::int
               from studio_members m
               join participants p on p.id = m.participant_id
               left join guardians gd on gd.child_id = p.child_id
               join passes ps on ps.owner_id = coalesce(p.user_id, gd.user_id)
              where m.group_id = g.id and m.left_at is null
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
      where p.user_id = $1
         or p.child_id in (select child_id from guardians where user_id = $1)
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
            (select count(*)::int from studio_members m
              where m.group_id = g.id and m.left_at is null) as people
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
            (select count(*)::int from studio_members m
              where m.group_id = g.id and m.left_at is null) as people
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

/** Удалять можно только пустое занятие: иначе потеряются отметки и деньги. */
export async function deleteSession(id: string): Promise<{ ok: boolean; reason?: string }> {
  const used = await one<{ n: string }>(
    `select (select count(*) from attendance where session_id = $1)
          + (select count(*) from charges where session_id = $1) as n`,
    [id],
  );
  if (Number(used?.n ?? 0) > 0) {
    return { ok: false, reason: 'В занятии есть отметки или начисления. Его можно отменить, но не удалить.' };
  }
  await query('delete from studio_sessions where id = $1', [id]);
  return { ok: true };
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
