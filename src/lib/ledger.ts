import type { PoolClient } from 'pg';
import { query } from './db';

/**
 * Реестр финансовых событий. Пишется в той же транзакции, что и само
 * изменение: если оно откатится, запись о нём не останется.
 */
export type MoneyKind =
  | 'charge_created'      // занятие посчитано
  | 'charge_removed'      // отметка снята, начисление убрано
  | 'charge_on_pass'      // списано с абонемента
  | 'charge_off_pass'     // занятие вернули в абонемент
  | 'cash_taken'          // деньги отданы студии напрямую
  | 'cash_reverted'       // такая оплата отменена
  | 'pass_issued'         // продан абонемент
  | 'pass_covered_debt'   // абонементом закрыт старый долг
  | 'payment_paid'        // платёж подтверждён провайдером
  | 'cash_declared'       // родитель заявил, что заплатит напрямую
  | 'cash_confirmed'      // студия подтвердила, что деньги получены
  | 'cash_declined';      // заявку отклонили

export type MoneyEvent = {
  kind: MoneyKind;
  actorId: string | null;
  ownerId?: string | null;
  participantId?: string | null;
  sessionId?: string | null;
  chargeId?: string | null;
  passId?: string | null;
  paymentId?: string | null;
  amount?: number | string | null;
  currency?: string | null;
  note?: string | null;
  details?: Record<string, unknown> | null;
};

const SQL = `insert into money_events
  (kind, actor_id, owner_id, participant_id, session_id, charge_id, pass_id, payment_id,
   amount, currency, note, details)
  values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`;

function params(e: MoneyEvent): unknown[] {
  return [
    e.kind, e.actorId ?? null, e.ownerId ?? null, e.participantId ?? null,
    e.sessionId ?? null, e.chargeId ?? null, e.passId ?? null, e.paymentId ?? null,
    e.amount ?? null, e.currency ?? null, e.note ?? null,
    e.details ? JSON.stringify(e.details) : null,
  ];
}

/** Внутри транзакции: событие живёт и умирает вместе с изменением. */
export async function logMoneyIn(c: PoolClient, e: MoneyEvent): Promise<void> {
  await c.query(SQL, params(e));
}

export async function logMoney(e: MoneyEvent): Promise<void> {
  await query(SQL, params(e));
}

export type LedgerRow = {
  id: string;
  at: string;
  kind: MoneyKind;
  amount: string | null;
  currency: string | null;
  note: string | null;
  actor: string | null;
  owner: string | null;
  who: string | null;
  group_title: string | null;
  held_on: string | null;
};

export async function ledger(limit = 100): Promise<LedgerRow[]> {
  return query<LedgerRow>(
    `select e.id, e.at::text, e.kind, e.amount::text, e.currency, e.note,
            coalesce(a.name, a.email) as actor,
            coalesce(o.name, o.email) as owner,
            coalesce(ch.name, pu.name, pu.email) as who,
            g.title as group_title,
            s.held_on::text
       from money_events e
       left join users a on a.id = e.actor_id
       left join users o on o.id = e.owner_id
       left join participants p on p.id = e.participant_id
       left join children ch on ch.id = p.child_id
       left join users pu on pu.id = p.user_id
       left join studio_sessions s on s.id = e.session_id
       left join studio_groups g on g.id = s.group_id
      order by e.at desc
      limit $1`,
    [limit],
  );
}
