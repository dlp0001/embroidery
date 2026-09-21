import type { PoolClient } from 'pg';
import { one, query, tx } from './db';
import { plural } from './format';
import { logMoneyIn } from './ledger';

export type AttendanceStatus = 'present' | 'absent' | 'sick' | 'trial';

export type PassType = { lessons: number; price: number; months: number };

/**
 * Занятия бывают трёх видов. Обычные идут по кругу каждую неделю,
 * лагерь и мастер-класс — в свои дни, со своей ценой и своими пакетами.
 */
export type GroupKind = 'lesson' | 'camp' | 'event';

export const KIND_NAME: Record<GroupKind, string> = {
  lesson: 'занятия',
  camp: 'лагерь',
  event: 'мастер-класс',
};

/** Пакет дней внутри лагеря или мастер-класса: свой, не студийный абонемент. */
export type PassOffer = { lessons: number; price: number };

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

/**
 * Цена занятия в этой группе. У лагеря и мастер-класса она своя, у
 * обычных занятий — общая студийная. Начисление всё равно запоминает
 * сумму у себя, так что прошлое от смены цены не меняется.
 */
export async function sessionPrice(
  sessionId: string,
): Promise<{ amount: number; currency: string }> {
  const row = await one<{ amount: string | null; currency: string | null }>(
    `select coalesce(g.price::text,
                     (select value from settings where key = 'studio_lesson_price')) as amount,
            (select value from settings where key = 'studio_currency') as currency
       from studio_sessions s join studio_groups g on g.id = s.group_id
      where s.id = $1`,
    [sessionId],
  );
  return { amount: Number(row?.amount ?? 100), currency: row?.currency ?? 'ILS' };
}

/**
 * Какие абонементы можно потратить на это занятие. Пакет, купленный в
 * лагерь, работает только в нём; обычный абонемент — только на обычных
 * занятиях. Одно правило на всё, чтобы деньги не списались не с того.
 */
export const PASS_FITS = `
  (ps.group_id = g.id or (ps.group_id is null and g.kind = 'lesson'))`;

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
      where p.user_id = $1 and u.attends
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
  /** Пусто, пока ребёнка не привязали к взрослому: платить некому. */
  owner_id: string | null;
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
  const { amount, currency } = await sessionPrice(sessionId);
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
        `select ps.id, ps.owner_id,
                ps.lessons_total - (select count(*)::int from charges c where c.pass_id = ps.id) as left
           from passes ps
           cross join (select g2.id, g2.kind from studio_sessions s2
                        join studio_groups g2 on g2.id = s2.group_id
                       where s2.id = $2) g
          where ps.owner_id = any($1::uuid[])
            and ps.valid_from <= current_date
            and (ps.valid_to is null or ps.valid_to >= current_date)
            and ${PASS_FITS}
          order by ps.valid_to nulls last, ps.created_at
          for update of ps`,
        [candidates, sessionId],
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
        // Владелец — тот, у кого есть свободный абонемент, иначе первый.
        // Пусто — ребёнка привели без родителя: начисление ждёт плательщика.
        const owner = list.find((o) => (passes.get(o)?.length ?? 0) > 0) ?? list[0] ?? null;
        const passId = way === 'pass' && owner ? takePass(owner) : null;
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
          note: passId ? 'списано с абонемента'
            : owner ? 'занятие в долг'
            : 'занятие посчитано, плательщик пока не известен',
        });
      }

      // Выбрали другой способ — занятие возвращается в абонемент.
      if (way !== 'pass' && charge.pass_id) {
        const freed = charge.pass_id;
        await c.query('update charges set pass_id = null where id = $1', [charge.id]);
        if (charge.owner_id) givePass(charge.owner_id, freed);
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

      if (way === 'pass' && !charge.pass_id && charge.owner_id) {
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
  /** Пакет лагеря: тратится только в нём. У обычного абонемента пусто. */
  group_id: string | null;
  group_title: string | null;
  kind: GroupKind;
};

export async function passBalances(ownerId: string): Promise<PassBalance[]> {
  return query<PassBalance>(
    `select p.id, p.lessons_total, p.valid_to::text, p.group_id,
            (select g.title from studio_groups g where g.id = p.group_id) as group_title,
            coalesce((select g.kind from studio_groups g where g.id = p.group_id), 'lesson') as kind,
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
        where g.active and g.kind = 'lesson' and extract(isodow from d) = g.weekday
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

/**
 * Записывает или снимает запись. Место занимается только если оно есть:
 * на экране полный день не нажимается, но два родителя могут потянуться
 * к последнему месту одновременно, и решает это база, а не экран.
 */
export async function setBooking(
  sessionId: string,
  participantId: string,
  booked: boolean,
): Promise<{ ok: boolean; reason?: string }> {
  if (booked) {
    const done = await tx(async (c) => {
      const { rows } = await c.query<{ capacity: number | null; taken: number }>(
        `select g.capacity,
                (select count(*)::int from bookings b
                  where b.session_id = s.id and b.status = 'booked'
                    and b.participant_id <> $2) as taken
           from studio_sessions s
           join studio_groups g on g.id = s.group_id
          where s.id = $1
          for update of s`,
        [sessionId, participantId],
      );
      const row = rows[0];
      if (!row) return false;
      if (row.capacity !== null && row.taken >= row.capacity) return false;
      await c.query(
        `insert into bookings (session_id, participant_id, status) values ($1, $2, 'booked')
         on conflict (session_id, participant_id) do update set status = 'booked'`,
        [sessionId, participantId],
      );
      return true;
    });
    if (!done) return { ok: false, reason: 'В этот день мест уже нет.' };
    return { ok: true };
  }
  {
    await query(
      `update bookings set status = 'cancelled' where session_id = $1 and participant_id = $2`,
      [sessionId, participantId],
    );
    return { ok: true };
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
  audience: string;
  people: number;
  marked: number;
};

/** Занятия преподавателя: сегодняшние и недавние незакрытые. */
export async function teacherSessions(teacherId: string | null): Promise<TeacherSession[]> {
  return query<TeacherSession>(
    `select s.id as session_id, g.id as group_id, g.title as group_title,
            s.held_on::text, g.starts_at::text, s.status, g.audience,
            (select count(*)::int
               from participants p
              where ((g.audience = 'adults' and p.user_id is not null)
                  or (g.audience = 'kids' and p.child_id is not null))
                and (exists (select 1 from preferred_days pd
                              where pd.participant_id = p.id and g.kind = 'lesson'
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
            s.held_on::text, g.starts_at::text, s.status, g.audience,
            (select count(*)::int from participants p
              where ((g.audience = 'adults' and p.user_id is not null)
                  or (g.audience = 'kids' and p.child_id is not null))
                and (exists (select 1 from preferred_days pd
                              where pd.participant_id = p.id and g.kind = 'lesson'
                                and pd.weekday = g.weekday)
                  or exists (select 1 from bookings b
                              where b.session_id = s.id and b.participant_id = p.id
                                and b.status = 'booked'))) as people,
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
            s.held_on::text, g.starts_at::text, s.status, g.audience,
            (select count(*)::int from participants p
              where ((g.audience = 'adults' and p.user_id is not null)
                  or (g.audience = 'kids' and p.child_id is not null))
                and (exists (select 1 from preferred_days pd
                              where pd.participant_id = p.id and g.kind = 'lesson'
                                and pd.weekday = g.weekday)
                  or exists (select 1 from bookings b
                              where b.session_id = s.id and b.participant_id = p.id
                                and b.status = 'booked'))) as people,
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
       select s.id, g.audience, g.kind, extract(isodow from s.held_on)::int as dow
         from studio_sessions s join studio_groups g on g.id = s.group_id
        where s.id = $1
     ),
     /* В журнале все, кто подходит занятию по типу: дети на детское,
        взрослые на взрослое. Кого ждём, решают записи и дни, но это
        только порядок в списке, а не право быть в нём.
        На мастер-класс приходят и те взрослые, кто обычно не ходит, —
        им хватает записи. */
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
          and ((ses.audience = 'adults' and p.user_id is not null
                and (u.attends or (ses.kind <> 'lesson' and exists (
                      select 1 from bookings b
                       where b.session_id = ses.id and b.participant_id = p.id
                         and b.status = 'booked'))))
            or (ses.audience = 'kids' and p.child_id is not null))
     )
     select o.participant_id, o.who, o.owner_id,
            a.status,
            coalesce((select count(*) from passes ps
                       cross join (select g2.id, g2.kind from studio_sessions s2
                                    join studio_groups g2 on g2.id = s2.group_id
                                   where s2.id = $1) g
                       where ps.owner_id = o.owner_id
                         and ps.valid_from <= current_date
                         and (ps.valid_to is null or ps.valid_to >= current_date)
                         and ${PASS_FITS}
                         and (select count(*) from charges c2 where c2.pass_id = ps.id) < ps.lessons_total
                     ) > 0, false) as has_pass,
            (c.pass_id is not null) as on_pass,
            (c.payment_id is not null) as paid,
            coalesce((select pay.provider = 'cash' from payments pay where pay.id = c.payment_id), false) as cash,
            (c.id is not null) as locked,
            coalesce(b.status = 'booked', false) as booked,
            exists (select 1 from preferred_days pd cross join ses
                     where pd.participant_id = o.participant_id and pd.weekday = ses.dow
                       and ses.kind = 'lesson') as preferred
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
  audience: string;
  teacher_id: string | null;
  kind: GroupKind;
  /** Цена этого дня: у лагеря своя. */
  price: string | null;
};

export async function sessionHead(sessionId: string): Promise<SessionHead | null> {
  return one<SessionHead>(
    `select s.id as session_id, g.title as group_title, g.age_hint,
            s.held_on::text, g.starts_at::text, s.status, g.audience, g.teacher_id, g.kind,
            coalesce(g.price::text,
                     (select value from settings where key = 'studio_lesson_price')) as price
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

// ── Расписание для родителя ───────────────────────────────

export type SlotRow = {
  session_id: string;
  held_on: string;
  starts_at: string;
  group_id: string;
  group_title: string;
  audience: 'kids' | 'adults';
  kind: GroupKind;
  /** Цена дня: у лагеря и мастер-класса своя. */
  price: string;
  weekday: number | null;
  capacity: number | null;
  taken: number;
  participant_id: string;
  who: string;
  is_adult: boolean;
  booked: boolean;
  preferred: boolean;
};

/** Общая часть запроса: кто из семьи на какое занятие может записаться. */
function slotsQuery(extra: string): string {
  return `select s.id as session_id, s.held_on::text, g.starts_at::text,
            g.id as group_id, g.title as group_title,
            g.audience, g.kind, g.weekday, g.capacity, g.duration_min,
            coalesce(g.price::text,
                     (select value from settings where key = 'studio_lesson_price')) as price,
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
        /* На мастер-класс записывается и взрослый, который обычно не ходит. */
        and (p.user_id is null or u.attends or g.kind <> 'lesson')
        and s.status <> 'cancelled'
        ${extra}
      order by s.held_on, g.starts_at, (p.user_id is not null) desc, who`;
}

export async function slotsForUser(userId: string, from: string, to: string): Promise<SlotRow[]> {
  return query<SlotRow>(
    slotsQuery('and s.held_on between $2::date and $3::date'),
    [userId, from, to],
  );
}

/**
 * Дни лагерей и мастер-классов впереди — все сразу, а не только на
 * ближайшую неделю. Смена начинается через месяц, и записываться на неё
 * удобнее одним списком, чем ходя по календарю день за днём.
 */
export async function eventSlotsForUser(userId: string): Promise<SlotRow[]> {
  return query<SlotRow>(
    slotsQuery(`and g.kind <> 'lesson' and s.held_on >= current_date`),
    [userId],
  );
}

export type FamilyMember = {
  participant_id: string;
  child_id: string | null;
  who: string;
  is_adult: boolean;
  attends: boolean;
  days: number[];
};

export async function familyWithDays(userId: string): Promise<FamilyMember[]> {
  return query<FamilyMember>(
    `select p.id as participant_id, p.child_id,
            coalesce(c.name, u.name, 'Я') as who,
            (p.user_id is not null) as is_adult,
            coalesce(u.attends, false) as attends,
            coalesce(array_agg(pd.weekday order by pd.weekday)
                     filter (where pd.weekday is not null), '{}') as days
       from participants p
       left join children c on c.id = p.child_id
       left join users u on u.id = p.user_id
       left join preferred_days pd on pd.participant_id = p.id
      where c.archived_at is null
        and (p.user_id = $1
             or p.child_id in (select child_id from guardians where user_id = $1))
      group by p.id, p.child_id, c.name, u.name, u.attends
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

export type PublicEvent = {
  id: string;
  title: string;
  kind: GroupKind;
  audience: 'kids' | 'adults';
  age_hint: string | null;
  starts_on: string;
  ends_on: string;
  starts_at: string;
  duration_min: number;
  weekdays: number[];
  price: string;
  pass_offers: PassOffer[] | null;
  capacity: number | null;
  /** Сколько дней в нём на самом деле: по ним считается пакет. */
  days: number;
};

/**
 * Лагеря и мастер-классы, о которых стоит рассказать на сайте: те, что
 * ещё не закончились. Страница живёт с этих данных, поэтому даты и цены
 * на ней всегда те же, что в кабинете.
 */
export async function publicEvents(): Promise<PublicEvent[]> {
  return query<PublicEvent>(
    `select g.id, g.title, g.kind, g.audience, g.age_hint,
            g.starts_on::text, g.ends_on::text, g.starts_at::text, g.duration_min,
            g.weekdays, g.price::text, g.pass_offers, g.capacity,
            (select count(*)::int from studio_sessions s
              where s.group_id = g.id and s.status <> 'cancelled') as days
       from studio_groups g
      where g.active and g.kind <> 'lesson'
        and g.starts_on is not null and g.ends_on is not null
        and g.ends_on >= current_date
      order by g.starts_on`,
  );
}

export type EventDay = {
  session_id: string;
  held_on: string;
  taken: number;
  capacity: number | null;
};

/** Дни смены для публичной страницы: с занятыми местами, без имён. */
export async function eventDays(groupId: string): Promise<EventDay[]> {
  return query<EventDay>(
    `select s.id as session_id, s.held_on::text, g.capacity,
            (select count(*)::int from bookings b
              where b.session_id = s.id and b.status = 'booked') as taken
       from studio_sessions s join studio_groups g on g.id = s.group_id
      where s.group_id = $1 and s.status <> 'cancelled'
      order by s.held_on`,
    [groupId],
  );
}

// ── Управление расписанием ────────────────────────────────

export type GroupRow = {
  id: string;
  title: string;
  teacher_id: string | null;
  weekday: number | null;
  starts_at: string;
  duration_min: number;
  room: string | null;
  audience: 'kids' | 'adults';
  age_hint: string | null;
  capacity: number | null;
  active: boolean;
  people: number;
  kind: GroupKind;
  /** Своя цена дня. У обычных занятий её нет — берётся студийная. */
  price: string | null;
  pass_offers: PassOffer[] | null;
  starts_on: string | null;
  ends_on: string | null;
  weekdays: number[];
  /** Сколько дней уже заведено: у лагеря это его размер. */
  days: number;
};

export async function allGroups(): Promise<GroupRow[]> {
  return query<GroupRow>(
    `select g.id, g.title, g.teacher_id, g.weekday, g.starts_at::text, g.duration_min,
            g.room, g.audience, g.age_hint, g.capacity, g.active,
            g.kind, g.price::text, g.pass_offers, g.starts_on::text, g.ends_on::text, g.weekdays,
            (select count(*)::int from studio_sessions s
              where s.group_id = g.id and s.status <> 'cancelled') as days,
            /* Те же люди, что и в журнале: скрытые дети и взрослые,
               которые сами не ходят, в счёт не идут. У лагеря дни недели
               не работают — там считаются записавшиеся. */
            case when g.kind = 'lesson' then
              (select count(*)::int from participants p
                 left join children ch on ch.id = p.child_id
                 left join users u on u.id = p.user_id
                where ch.archived_at is null
                  and ((g.audience = 'adults' and p.user_id is not null and u.attends)
                    or (g.audience = 'kids' and p.child_id is not null))
                  and exists (select 1 from preferred_days pd
                               where pd.participant_id = p.id and pd.weekday = g.weekday))
            else
              (select count(distinct b.participant_id)::int
                 from bookings b join studio_sessions s on s.id = b.session_id
                where s.group_id = g.id and b.status = 'booked')
            end as people
       from studio_groups g
      order by g.active desc, g.kind <> 'lesson', g.weekday nulls last, g.starts_at`,
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
  weekday: number | null;
  startsAt: string;
  durationMin: number;
  audience: 'kids' | 'adults';
  ageHint: string | null;
  capacity: number | null;
  room: string | null;
  teacherId: string | null;
  kind: GroupKind;
  price: number | null;
  passOffers: PassOffer[] | null;
  startsOn: string | null;
  endsOn: string | null;
  weekdays: number[];
};

const GROUP_COLS = [
  'title', 'weekday', 'starts_at', 'duration_min', 'audience', 'age_hint',
  'capacity', 'room', 'teacher_id', 'kind', 'price', 'pass_offers',
  'starts_on', 'ends_on', 'weekdays',
];

function groupValues(input: GroupInput): unknown[] {
  return [
    input.title, input.weekday, input.startsAt, input.durationMin, input.audience,
    input.ageHint, input.capacity, input.room, input.teacherId, input.kind,
    input.price, input.passOffers ? JSON.stringify(input.passOffers) : null,
    input.startsOn, input.endsOn, input.weekdays,
  ];
}

export async function createGroup(input: GroupInput): Promise<string> {
  const row = await one<{ id: string }>(
    `insert into studio_groups (${GROUP_COLS.join(', ')})
     values (${GROUP_COLS.map((_, i) => `$${i + 1}`).join(', ')}) returning id`,
    groupValues(input),
  );
  return row!.id;
}

export async function updateGroup(id: string, input: GroupInput): Promise<void> {
  await query(
    `update studio_groups
        set ${GROUP_COLS.map((c, i) => `${c} = $${i + 2}`).join(', ')}
      where id = $1`,
    [id, ...groupValues(input)],
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
  /** Журнал закрыт: хоть одна отметка есть, неважно какая. */
  marked: number;
  /** Пришли: только те, у кого стоит «был». */
  came: number;
  /** Ждали: записанные на занятие плюс те, у кого этот день в профиле. */
  expected: number;
  /** Из них записались сами: сказали, что придут именно на это занятие. */
  booked: number;
};

export async function sessionsInRange(from: string, to: string): Promise<CalendarSession[]> {
  return query<CalendarSession>(
    `select s.id as session_id, g.id as group_id, g.title as group_title,
            s.held_on::text, g.starts_at::text, s.status, g.audience,
            (select count(*)::int from attendance a where a.session_id = s.id) as marked,
            (select count(*)::int from attendance a
              where a.session_id = s.id and a.status = 'present') as came,
            /* Кого ждали — ровно те, кто в журнале попадает в блок «ждём». */
            (select count(*)::int
               from participants p
               left join children ch on ch.id = p.child_id
               left join users u on u.id = p.user_id
              where ch.archived_at is null
                and ((g.audience = 'adults' and p.user_id is not null and u.attends)
                  or (g.audience = 'kids' and p.child_id is not null))
                and (exists (select 1 from preferred_days pd
                              where pd.participant_id = p.id and g.kind = 'lesson'
                                and pd.weekday = g.weekday)
                  or exists (select 1 from bookings b
                              where b.session_id = s.id and b.participant_id = p.id
                                and b.status = 'booked'))) as expected,
            (select count(*)::int
               from bookings b
               join participants p on p.id = b.participant_id
               left join children ch on ch.id = p.child_id
               left join users u on u.id = p.user_id
              where b.session_id = s.id and b.status = 'booked'
                and ch.archived_at is null
                and ((g.audience = 'adults' and p.user_id is not null and u.attends)
                  or (g.audience = 'kids' and p.child_id is not null))) as booked
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
 *
 * Обычная группа расставляется по кругу на несколько недель вперёд.
 * Лагерь и мастер-класс — ровно по своему периоду: сколько дней задано,
 * столько и будет, ни одним больше.
 */
export async function resyncGroupSessions(groupId: string, weeksAhead = 6): Promise<void> {
  await tx(async (c) => {
    // Сегодняшний день тоже пересобираем: правка расписания утром
    // должна убирать сегодняшнее занятие, а не оставлять его висеть
    // до завтра. Прошлое не трогаем, как и всё, где уже есть отметки,
    // деньги или записи.
    await c.query(
      `delete from studio_sessions s
        where s.group_id = $1
          and s.held_on >= current_date
          and not exists (select 1 from attendance a where a.session_id = s.id)
          and not exists (select 1 from charges ch where ch.session_id = s.id)
          and not exists (select 1 from bookings b where b.session_id = s.id
                            and b.status = 'booked')`,
      [groupId],
    );
    await c.query(
      `insert into studio_sessions (group_id, held_on)
       select g.id, d::date
         from studio_groups g
         cross join generate_series(
                      case when g.kind = 'lesson' then current_date
                           else greatest(g.starts_on, current_date) end,
                      case when g.kind = 'lesson'
                           then current_date + ($2 || ' weeks')::interval
                           else g.ends_on::timestamp end,
                      interval '1 day') d
        where g.id = $1 and g.active
          and (case when g.kind = 'lesson'
                    then extract(isodow from d) = g.weekday
                    else g.starts_on is not null and g.ends_on is not null
                         and (cardinality(g.weekdays) = 0
                              or extract(isodow from d)::int = any(g.weekdays))
               end)
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
  /** Пакет лагеря принадлежит своей группе и тратится только в ней. */
  groupId?: string | null;
  /** Цена пакета, если она своя. Без неё считаем по студийной. */
  price?: number | null;
  /** Последний день пакета: у лагеря он заканчивается вместе с лагерем. */
  validTo?: string | null;
};

export type SaleOffer = {
  /** Ключ для формы: «» для студийного абонемента, иначе id группы. */
  groupId: string | null;
  groupTitle: string | null;
  kind: GroupKind;
  lessons: number;
  price: number;
  months: number;
  /** Последний день у пакета группы; у абонемента считается от покупки. */
  validTo: string | null;
};

/**
 * Всё, что сейчас можно продать: студийные абонементы и пакеты лагерей
 * и мастер-классов, которые ещё не кончились. Одно место, откуда берут
 * список и Варя в журнале, и родитель в кабинете.
 */
export async function saleOffers(): Promise<SaleOffer[]> {
  const [types, groups] = await Promise.all([
    passTypes(),
    query<{ id: string; title: string; kind: GroupKind; pass_offers: PassOffer[] | null; ends_on: string | null }>(
      `select g.id, g.title, g.kind, g.pass_offers, g.ends_on::text
         from studio_groups g
        where g.active and g.kind <> 'lesson' and g.pass_offers is not null
          and (g.ends_on is null or g.ends_on >= current_date)
        order by g.starts_on`,
    ),
  ]);

  const studio: SaleOffer[] = types.map((t) => ({
    groupId: null, groupTitle: null, kind: 'lesson' as const,
    lessons: t.lessons, price: t.price, months: t.months, validTo: null,
  }));

  const packs: SaleOffer[] = groups.flatMap((g) =>
    (g.pass_offers ?? []).map((o) => ({
      groupId: g.id, groupTitle: g.title, kind: g.kind,
      lessons: o.lessons, price: o.price, months: 0, validTo: g.ends_on,
    })),
  );

  return [...studio, ...packs];
}

/**
 * Выдаёт абонемент. При оплате наличными или переводом сразу заводит
 * платёж. Если попросили, гасит уже накопленные неоплаченные занятия:
 * самые старые вперёд, пока хватает занятий в пакете.
 */
export async function issuePass(input: IssuePassInput, byUser: string): Promise<{ covered: number }> {
  const { amount, currency } = await lessonPrice();
  // Абонемент стоит своих денег; если пакет нестандартный, считаем по занятиям.
  const type = (await passTypes()).find((t) => t.lessons === input.lessons);
  const total = input.price ?? (type ? type.price : amount * input.lessons);
  const groupId = input.groupId ?? null;
  const groupTitle = groupId
    ? (await one<{ title: string }>('select title from studio_groups where id = $1', [groupId]))?.title ?? null
    : null;
  const what = groupTitle
    ? `${groupTitle}: пакет на ${input.lessons} ${plural(input.lessons, 'день', 'дня', 'дней')}`
    : `абонемент на ${input.lessons} ${plural(input.lessons, 'занятие', 'занятия', 'занятий')}`;

  return tx(async (c) => {
    let paymentId: string | null = null;
    if (input.paid !== 'unpaid') {
      const pay = await c.query<{ id: string }>(
        `insert into payments (provider, user_id, amount, currency, status, purpose, raw)
         values ($1, $2, $3, $4, 'paid', 'studio_pass', $5) returning id`,
        [input.paid, input.ownerId, total, currency,
         JSON.stringify({
           issued_by: byUser, lessons: input.lessons,
           group_id: groupId, group_title: groupTitle,
         })],
      );
      paymentId = pay.rows[0].id;
    }

    const pass = await c.query<{ id: string }>(
      `insert into passes (owner_id, lessons_total, valid_from, valid_to, payment_id, group_id)
       values ($1, $2, current_date,
               coalesce($5::date, current_date + ($3 || ' months')::interval), $4, $6)
       returning id`,
      [input.ownerId, input.lessons, String(input.months), paymentId,
       input.validTo ?? null, groupId],
    );
    const passId = pass.rows[0].id;

    await logMoneyIn(c, {
      kind: 'pass_issued', actorId: byUser, ownerId: input.ownerId,
      passId, paymentId, amount: total, currency,
      note: `${what}, ${
        input.paid === 'cash' ? 'наличными' : input.paid === 'transfer' ? 'переводом' : 'не оплачен'
      }`,
      details: { lessons: input.lessons, months: input.months, paid: input.paid, group_id: groupId },
    });

    let covered = 0;
    if (input.coverDebt) {
      // Гасим только то, на что этот пакет и годится: дни лагеря —
      // лагерным, обычные занятия — обычным абонементом.
      const debts = await c.query<{ id: string; amount: string }>(
        `select ch.id, ch.amount::text from charges ch
           join studio_sessions s on s.id = ch.session_id
           join studio_groups g on g.id = s.group_id
          where ch.owner_id = $1 and ch.pass_id is null and ch.payment_id is null
            and ($3::uuid is null and g.kind = 'lesson' or g.id = $3::uuid)
          order by s.held_on
          limit $2`,
        [input.ownerId, input.lessons, groupId],
      );
      for (const row of debts.rows) {
        await c.query('update charges set pass_id = $2 where id = $1', [row.id, passId]);
        await logMoneyIn(c, {
          kind: 'pass_covered_debt', actorId: byUser, ownerId: input.ownerId,
          chargeId: row.id, passId, amount: row.amount, currency,
          note: groupTitle ? 'день закрыт пакетом' : 'старое занятие закрыто абонементом',
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
  group_title: string | null;
  kind: GroupKind;
};

export async function allActivePasses(): Promise<PassRow[]> {
  return query<PassRow>(
    `select p.id, u.name as owner_name, u.email as owner_email, p.lessons_total,
            p.lessons_total - (select count(*)::int from charges c where c.pass_id = p.id) as left,
            p.valid_to::text,
            (select g.title from studio_groups g where g.id = p.group_id) as group_title,
            coalesce((select g.kind from studio_groups g where g.id = p.group_id), 'lesson') as kind,
            (select pay.provider from payments pay where pay.id = p.payment_id) as paid
       from passes p
       join users u on u.id = p.owner_id
      where (p.valid_to is null or p.valid_to >= current_date)
        /* Израсходованный абонемент действующим не считается: тратить
           в нём нечего, а в списке он мешает видеть настоящие. */
        and p.lessons_total > (select count(*) from charges c where c.pass_id = p.id)
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
  billing_name: string | null;
  telegram: string | null;
  email: string;
  roles: string[];
  attends: boolean;
  own_days: number[];
  children: FamilyChild[];
};

/** Все взрослые с детьми и составом групп. */
export async function families(): Promise<Family[]> {
  const rows = await query<Family>(
    `select u.id as user_id, u.name, u.billing_name, u.telegram, u.email, u.attends,
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

/**
 * Заводит родителя вручную. Адрес уже может быть в базе: человек покупал
 * курс или его завели раньше. Тогда дописываем то, чего не хватало,
 * и не стираем то, что уже стоит — пустое поле формы не должно
 * затирать заполненное.
 */
export async function createParent(
  email: string, name: string, telegram: string | null,
): Promise<string> {
  const row = await one<{ id: string }>(
    `insert into users (email, name, telegram) values ($1, $2, $3)
     on conflict (email) do update set name = coalesce(excluded.name, users.name),
                                       telegram = coalesce(excluded.telegram, users.telegram)
     returning id`,
    [email.trim().toLowerCase(), name.trim() || null, telegram],
  );
  await query(`insert into user_roles (user_id, role) values ($1, 'parent') on conflict do nothing`, [row!.id]);
  await query('insert into participants (user_id) values ($1) on conflict do nothing', [row!.id]);
  return row!.id;
}

/**
 * Ходит ли взрослый на занятия сам. По умолчанию нет: он просто родитель.
 * Сказал «да» — заводим ему участника, иначе отмечать дни будет не на ком.
 */
export async function setAttends(userId: string, attends: boolean): Promise<void> {
  await tx(async (c) => {
    await c.query('update users set attends = $2 where id = $1', [userId, attends]);
    if (attends) {
      await c.query(
        'insert into participants (user_id) values ($1) on conflict do nothing', [userId]);
    }
  });
}

/** Своя карточка: имя и ник в телеграме родитель правит сам. Ник приходит уже разобранным. */
export async function saveProfile(
  userId: string, name: string, telegram: string | null,
): Promise<void> {
  await query(
    'update users set name = $2, telegram = $3 where id = $1',
    [userId, name.trim() || null, telegram],
  );
}

/**
 * Правка админа: заодно с именем правятся и то, как человек назван
 * в квитанции, и ник в телеграме. Ник приходит уже разобранным.
 */
export async function saveParent(
  userId: string, name: string, billingName: string, telegram: string | null,
): Promise<void> {
  await query(
    'update users set name = $2, billing_name = $3, telegram = $4 where id = $1',
    [userId, name.trim() || null, billingName.trim() || null, telegram],
  );
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
 * Прячет ребёнка: он перестаёт появляться в журналах, в расписании и в
 * списках для записи, но всё, что с ним было, остаётся на месте. Ничего
 * не удаляем: за ребёнком могут стоять посещения и деньги, а «скрыть» и
 * «стереть» — разные обещания.
 */
export async function hideChild(childId: string): Promise<{ name: string | null }> {
  const row = await one<{ name: string }>(
    `update children set archived_at = now()
      where id = $1 and archived_at is null returning name`,
    [childId],
  );
  return { name: row?.name ?? null };
}

/**
 * Ребёнок, которого привели на занятие прямо сейчас. Родителя у него ещё
 * нет: заводим запись, ставим «был» и сразу считаем занятие.
 *
 * Начисление создаём здесь же, а не ждём «Сохранить»: на экране ребёнок
 * уже отмечен, и выглядит это как готовое дело. Раз отметка настоящая,
 * деньги за неё должны считаться так же, как у всех. Плательщика пока
 * нет — начисление ждёт привязки к взрослому.
 */
export async function addWalkIn(
  sessionId: string, name: string, actorId: string,
): Promise<{ ok: boolean; reason?: string }> {
  const ses = await one<{ audience: string }>(
    `select g.audience from studio_sessions s
       join studio_groups g on g.id = s.group_id where s.id = $1`,
    [sessionId],
  );
  if (!ses) return { ok: false, reason: 'Занятие не найдено.' };
  if (ses.audience !== 'kids') {
    return { ok: false, reason: 'На взрослое занятие человека заводят через «Люди»: ему нужен вход в кабинет.' };
  }

  await tx(async (c) => {
    const child = await c.query<{ id: string }>(
      'insert into children (name) values ($1) returning id', [name]);
    const part = await c.query<{ id: string }>(
      'insert into participants (child_id) values ($1) returning id', [child.rows[0].id]);
    await c.query(
      `insert into attendance (session_id, participant_id, status, marked_by)
       values ($1, $2, 'present', $3)
       on conflict (session_id, participant_id) do nothing`,
      [sessionId, part.rows[0].id, actorId]);

    const { amount, currency } = await sessionPrice(sessionId);
    const charge = await c.query<{ id: string }>(
      `insert into charges (participant_id, session_id, amount, currency)
       values ($1, $2, $3, $4)
       on conflict (participant_id, session_id) do nothing
       returning id`,
      [part.rows[0].id, sessionId, amount, currency]);

    if (charge.rows[0]) {
      await logMoneyIn(c, {
        kind: 'charge_created', actorId,
        participantId: part.rows[0].id, sessionId, chargeId: charge.rows[0].id,
        amount, currency,
        note: 'занятие посчитано, плательщик пока не известен',
      });
    }
  });
  return { ok: true };
}

export type OrphanChild = {
  child_id: string;
  participant_id: string;
  name: string;
  visits: number;
  last_seen: string | null;
};

/** Дети без родителя: за них некому платить, поэтому их видно отдельно. */
export async function orphanChildren(): Promise<OrphanChild[]> {
  return query<OrphanChild>(
    `select ch.id as child_id, p.id as participant_id, ch.name,
            (select count(*)::int from attendance a
              where a.participant_id = p.id and a.status = 'present') as visits,
            (select max(s.held_on)::text from attendance a
               join studio_sessions s on s.id = a.session_id
              where a.participant_id = p.id and a.status = 'present') as last_seen
       from children ch
       join participants p on p.child_id = ch.id
      where ch.archived_at is null
        and not exists (select 1 from guardians g where g.child_id = ch.id)
      order by ch.name`,
  );
}

/**
 * Посещения, за которые некому платить: ребёнок пока без родителя.
 *
 * Считаем по самим посещениям, а не по начислениям. Ребёнка, которого
 * привели прямо на занятие, отмечают сразу, а начисление появляется
 * только когда Варя сохранит журнал: по начислениям такое посещение
 * пропало бы из счёта, хотя деньги за него никто не считал.
 */
export async function unbilledVisits(): Promise<number> {
  const row = await one<{ n: number }>(
    `select count(*)::int as n
       from attendance a
       join participants p on p.id = a.participant_id
       join children ch on ch.id = p.child_id
      where a.status = 'present'
        and not exists (select 1 from guardians g where g.child_id = ch.id)
        and not exists (select 1 from charges x
                         where x.participant_id = a.participant_id
                           and x.session_id = a.session_id
                           and x.payment_id is not null)`,
  );
  return row?.n ?? 0;
}

/**
 * За сколько дней до конца абонемента начинаем предупреждать. Раньше
 * незачем, позже уже не успеть отходить остаток.
 */
export const PASS_WARN_DAYS = 7;

/** Сколько в студии людей. Варю и админов не считаем: они не ученики. */
export async function peopleCount(): Promise<{ adults: number; children: number }> {
  const row = await one<{ adults: number; children: number }>(
    `select (select count(*)::int from users u
              where exists (select 1 from user_roles r
                             where r.user_id = u.id and r.role in ('parent', 'student'))
                and not exists (select 1 from user_roles r
                                 where r.user_id = u.id
                                   and r.role in ('admin', 'superadmin', 'teacher'))) as adults,
            (select count(*)::int from children where archived_at is null) as children`,
  );
  return { adults: row?.adults ?? 0, children: row?.children ?? 0 };
}

/**
 * Привязывает ребёнка к взрослому и, если попросили, забирает на него
 * прошлые занятия: посчитанные переезжают вместе со своей ценой и
 * оплатой, а непосчитанные — те, что отметили, когда платить было
 * некому, — считаются сейчас, по нынешней цене.
 *
 * Абонемент при этом не трогаем. Списывать занятие задним числом —
 * решение Вари, а не наше: она откроет журнал и поставит «по абонементу»
 * сама, если так и было.
 */
export async function linkChild(
  childId: string, userId: string, takePast: boolean, byUser: string,
): Promise<{ moved: number; counted: number }> {
  return tx(async (c) => {
    await c.query(
      'insert into guardians (child_id, user_id) values ($1, $2) on conflict do nothing',
      [childId, userId]);
    if (!takePast) return { moved: 0, counted: 0 };

    const { rows } = await c.query<{
      id: string; participant_id: string; session_id: string;
      amount: string; currency: string; payment_id: string | null;
    }>(
      `update charges ch set owner_id = $2
         from participants p
        where p.id = ch.participant_id and p.child_id = $1 and ch.owner_id is null
        returning ch.id, ch.participant_id, ch.session_id, ch.amount::text, ch.currency,
                  ch.payment_id`,
      [childId, userId]);

    for (const r of rows) {
      // Наличные, принятые до привязки, тоже обретают плательщика.
      if (r.payment_id) {
        await c.query('update payments set user_id = $2 where id = $1 and user_id is null',
          [r.payment_id, userId]);
      }
      await logMoneyIn(c, {
        kind: r.payment_id ? 'cash_taken' : 'charge_created',
        actorId: byUser, ownerId: userId,
        participantId: r.participant_id, sessionId: r.session_id,
        chargeId: r.id, paymentId: r.payment_id, amount: r.amount, currency: r.currency,
        note: r.payment_id
          ? 'оплаченное занятие закреплено за родителем'
          : 'занятие закреплено за родителем',
      });
    }

    // Посещения, по которым начисления нет вовсе: их отметили, когда
    // плательщика ещё не было, и деньги за них никто не считал.
    const { rows: missed } = await c.query<{
      participant_id: string; session_id: string; amount: string; currency: string;
    }>(
      `select a.participant_id, a.session_id,
              coalesce(g.price::text,
                       (select value from settings where key = 'studio_lesson_price')) as amount,
              coalesce((select value from settings where key = 'studio_currency'), 'ILS') as currency
         from attendance a
         join participants p on p.id = a.participant_id
         join studio_sessions s on s.id = a.session_id
         join studio_groups g on g.id = s.group_id
        where p.child_id = $1 and a.status = 'present'
          and not exists (select 1 from charges x
                           where x.participant_id = a.participant_id
                             and x.session_id = a.session_id)`,
      [childId]);

    for (const m of missed) {
      const made = await c.query<{ id: string }>(
        `insert into charges (participant_id, session_id, owner_id, amount, currency)
         values ($1, $2, $3, $4, $5) returning id`,
        [m.participant_id, m.session_id, userId, m.amount, m.currency]);
      await logMoneyIn(c, {
        kind: 'charge_created', actorId: byUser, ownerId: userId,
        participantId: m.participant_id, sessionId: m.session_id,
        chargeId: made.rows[0].id, amount: m.amount, currency: m.currency,
        note: 'занятие посчитано при привязке к родителю, по нынешней цене',
      });
    }

    return { moved: rows.length, counted: missed.length };
  });
}

/**
 * Склеивает двух детей в одного: так бывает, когда ребёнка сначала
 * заводит Варя на занятии, а потом родитель добавляет его сам.
 *
 * Всё, что накопилось за лишней записью — записи на занятия, отметки,
 * начисления, дни и составы групп, — переезжает на ту, что остаётся.
 * Там, где обе записи оказались на одном занятии, побеждает остающаяся:
 * дублировать посещение или начисление нельзя. Опекуны объединяются,
 * лишняя запись удаляется.
 */
export type MergeResult = { ok: boolean; reason?: string; moved: number; name?: string };

export async function mergeChildren(
  fromChildId: string, intoChildId: string, byUser: string,
): Promise<MergeResult> {
  if (fromChildId === intoChildId) return { ok: false, reason: 'Это одна и та же запись.', moved: 0 };

  return tx(async (c) => {
    const { rows: pair } = await c.query<{ child_id: string; participant_id: string; name: string }>(
      `select ch.id as child_id, p.id as participant_id, ch.name
         from children ch join participants p on p.child_id = ch.id
        where ch.id = any($1::uuid[])`,
      [[fromChildId, intoChildId]]);
    const from = pair.find((r) => r.child_id === fromChildId);
    const into = pair.find((r) => r.child_id === intoChildId);
    if (!from || !into) return { ok: false, reason: 'Одну из записей не нашли.', moved: 0 };

    let moved = 0;
    const move = async (table: string, key: string) => {
      const { rowCount } = await c.query(
        `update ${table} set participant_id = $2
          where participant_id = $1
            and not exists (select 1 from ${table} t
                             where t.participant_id = $2 and t.${key} = ${table}.${key})`,
        [from.participant_id, into.participant_id]);
      moved += rowCount ?? 0;
      // Что не переехало — дубль по тому же занятию или дню: он лишний.
      await c.query(`delete from ${table} where participant_id = $1`, [from.participant_id]);
    };

    await move('bookings', 'session_id');
    await move('attendance', 'session_id');
    await move('charges', 'session_id');
    await move('preferred_days', 'weekday');
    await move('studio_members', 'group_id');

    // Родители обеих записей становятся родителями оставшейся.
    await c.query(
      `insert into guardians (child_id, user_id)
       select $2, g.user_id from guardians g where g.child_id = $1
       on conflict do nothing`,
      [fromChildId, intoChildId]);

    await c.query('delete from children where id = $1', [fromChildId]);

    await logMoneyIn(c, {
      kind: 'child_merged', actorId: byUser, participantId: into.participant_id,
      note: `«${from.name}» объединён(а) с «${into.name}»: перенесено записей ${moved}`,
      details: { merged_from: fromChildId, into: intoChildId, moved },
    });

    return { ok: true, moved, name: from.name };
  });
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


