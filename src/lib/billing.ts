import { one, query, tx } from './db';
import { plural } from './format';
import { logMoneyIn } from './ledger';
import { createPaymentLink, isConfigured } from './payplus';
import { lessonPrice } from './studio';

export type Intent =
  | { kind: 'debt'; chargeIds?: string[] }
  | { kind: 'pass'; lessons: number; months: number }
  | { kind: 'test' };

/** Сумма проверочного платежа: маленькая, чтобы не жалко было вернуть. */
export const TEST_AMOUNT = 5;

/**
 * Заводит платёж в состоянии «ждёт» и отдаёт ссылку на страницу PayPlus.
 * Что оплачивается, помним в самой записи: обратный вызов по ней и
 * поймёт, к чему привязать деньги.
 */
export async function startPayment(
  user: { id: string; email: string; name: string | null },
  intent: Intent,
  origin: string,
): Promise<{ url: string; paymentId: string } | { error: string }> {
  if (!isConfigured()) return { error: 'Оплата картой ещё не подключена.' };

  const price = await lessonPrice();
  let amount: number;
  let description: string;
  let raw: Record<string, unknown>;

  if (intent.kind === 'test') {
    amount = TEST_AMOUNT;
    description = 'Проверка оплаты';
    raw = {};
  } else if (intent.kind === 'debt') {
    // Родитель может выбрать не всё: платим ровно за отмеченное.
    const picked = intent.chargeIds?.length ? intent.chargeIds : null;
    const debts = await query<{ id: string; amount: string }>(
      `select id, amount::text from charges
        where owner_id = $1 and pass_id is null and payment_id is null
          and ($2::uuid[] is null or id = any($2::uuid[]))
        order by created_at`,
      [user.id, picked],
    );
    if (debts.length === 0) return { error: 'Нечего оплачивать.' };
    amount = debts.reduce((s, c) => s + Number(c.amount), 0);
    description = `Занятия в студии, ${debts.length}`;
    raw = { charge_ids: debts.map((c) => c.id) };
  } else {
    if (intent.lessons < 1 || intent.lessons > 100) return { error: 'Странное число занятий.' };
    amount = price.amount * intent.lessons;
    description = `Абонемент на ${intent.lessons} занятий`;
    raw = { lessons: intent.lessons, months: intent.months };
  }

  const payment = await one<{ id: string }>(
    `insert into payments (provider, user_id, amount, currency, status, purpose, raw)
     values ('payplus', $1, $2, $3, 'pending', $4, $5) returning id`,
    [user.id, amount, price.currency,
     intent.kind === 'debt' ? 'studio_debt' : intent.kind === 'test' ? 'studio_test' : 'studio_pass',
     JSON.stringify(raw)],
  );

  try {
    const link = await createPaymentLink({
      amount,
      currency: price.currency,
      customerName: user.name ?? user.email,
      email: user.email,
      description,
      reference: payment!.id,
      successUrl: `${origin}/account/pay/done?ok=1`,
      failureUrl: `${origin}/account/pay/done?ok=0`,
      callbackUrl: `${origin}/api/webhook-payplus`,
    });
    await query(
      `update payments set provider_id = $2, raw = raw || jsonb_build_object('url', $3::text)
        where id = $1`,
      [payment!.id, link.pageRequestUid, link.url],
    );
    return { url: link.url, paymentId: payment!.id };
  } catch (err) {
    console.error('payplus: не удалось создать ссылку', err);
    await query(`update payments set status = 'failed' where id = $1`, [payment!.id]);
    const reason = err instanceof Error ? err.message : 'неизвестная причина';
    return { error: `PayPlus не дал страницу оплаты: ${reason}` };
  }
}

/**
 * Отмечает платёж оплаченным и раздаёт то, за что заплатили.
 * Идемпотентно: повторный вызов ничего не меняет.
 */
export type TestPayment = { id: string; status: string; created_at: string; amount: string };

export async function lastTestPayment(userId: string): Promise<TestPayment | null> {
  return one<TestPayment>(
    `select id, status, created_at::text, amount::text from payments
      where user_id = $1 and purpose = 'studio_test'
      order by created_at desc limit 1`,
    [userId],
  );
}

export async function checkoutUrl(paymentId: string, userId: string): Promise<string | null> {
  const row = await one<{ raw: { url?: string } | null }>(
    `select raw from payments
      where id = $1 and user_id = $2 and provider = 'payplus' and status = 'pending'`,
    [paymentId, userId],
  );
  return row?.raw?.url ?? null;
}

export async function applyPayment(paymentId: string, transactionUid: string | null): Promise<void> {
  await tx(async (c) => {
    const { rows } = await c.query<{
      id: string; user_id: string; status: string; purpose: string;
      amount: string; currency: string; raw: Record<string, unknown> | null;
    }>('select id, user_id, status, purpose, amount, currency, raw from payments where id = $1 for update',
      [paymentId]);

    const p = rows[0];
    if (!p || p.status === 'paid') return;

    await c.query(
      `update payments set status = 'paid', provider_id = coalesce($2, provider_id) where id = $1`,
      [p.id, transactionUid],
    );
    await logMoneyIn(c, {
      kind: 'payment_paid', actorId: null, ownerId: p.user_id, paymentId: p.id,
      amount: p.amount, currency: p.currency,
      note: p.purpose === 'studio_pass' ? 'оплачен абонемент'
        : p.purpose === 'studio_debt' ? 'оплачен долг' : 'проверочный платёж',
      details: { provider: 'payplus', transaction: transactionUid },
    });

    // Проверочный платёж ничего не выдаёт: он нужен только чтобы
    // убедиться, что деньги доходят и обратный вызов срабатывает.
    if (p.purpose === 'studio_test') return;

    if (p.purpose === 'studio_debt') {
      const ids = (p.raw?.charge_ids as string[] | undefined) ?? [];
      if (ids.length > 0) {
        const { rows: settled } = await c.query<{ id: string }>(
          `update charges set payment_id = $1
            where id = any($2::uuid[]) and pass_id is null and payment_id is null
            returning id`,
          [p.id, ids],
        );
        for (const row of settled) {
          await logMoneyIn(c, {
            kind: 'payment_paid', actorId: null, ownerId: p.user_id,
            chargeId: row.id, paymentId: p.id, amount: null, currency: p.currency,
            note: 'занятие закрыто картой',
          });
        }
      }
      return;
    }

    if (p.purpose === 'studio_pass') {
      const lessons = Number(p.raw?.lessons ?? 0);
      const months = Number(p.raw?.months ?? 3);
      if (lessons < 1) return;
      const { rows: made } = await c.query<{ id: string }>(
        `insert into passes (owner_id, lessons_total, valid_from, valid_to, payment_id)
         values ($1, $2, current_date, current_date + ($3 || ' months')::interval, $4)
         returning id`,
        [p.user_id, lessons, String(months), p.id],
      );
      await logMoneyIn(c, {
        kind: 'pass_issued', actorId: null, ownerId: p.user_id,
        passId: made[0].id, paymentId: p.id, amount: p.amount, currency: p.currency,
        note: `абонемент на ${lessons} ${plural(lessons, 'занятие', 'занятия', 'занятий')}, оплачен картой`,
        details: { lessons, months },
      });
    }
  });
}

// ── Наличные по заявке родителя ───────────────────────────

export type CashClaim = {
  id: string;
  amount: string;
  currency: string;
  created_at: string;
  owner_name: string | null;
  owner_email: string;
  lessons: number;
};

/**
 * Родитель заявляет, что заплатит наличными. Деньги не считаются
 * полученными, пока студия не подтвердит: занятия остаются в долгу.
 */
export async function declareCash(
  user: { id: string },
  chargeIds: string[],
): Promise<{ ok: true; count: number } | { error: string }> {
  const picked = chargeIds.length ? chargeIds : null;
  const debts = await query<{ id: string; amount: string; currency: string }>(
    `select id, amount::text, currency from charges
      where owner_id = $1 and pass_id is null and payment_id is null
        and ($2::uuid[] is null or id = any($2::uuid[]))
      order by created_at`,
    [user.id, picked],
  );
  if (debts.length === 0) return { error: 'Нечего оплачивать.' };

  const amount = debts.reduce((s, c) => s + Number(c.amount), 0);
  const currency = debts[0].currency;

  await tx(async (c) => {
    const { rows } = await c.query<{ id: string }>(
      `insert into payments (provider, user_id, amount, currency, status, purpose, raw)
       values ('cash', $1, $2, $3, 'pending', 'studio_debt', $4) returning id`,
      [user.id, amount, currency, JSON.stringify({ charge_ids: debts.map((d) => d.id) })],
    );
    await logMoneyIn(c, {
      kind: 'cash_declared', actorId: user.id, ownerId: user.id,
      paymentId: rows[0].id, amount, currency,
      note: `родитель заявил оплату наличными за ${debts.length} ${plural(debts.length, 'занятие', 'занятия', 'занятий')}`,
      details: { charge_ids: debts.map((d) => d.id) },
    });
  });

  return { ok: true, count: debts.length };
}

/** Заявки, которые ждут подтверждения студии. */
export async function pendingCash(): Promise<CashClaim[]> {
  return query<CashClaim>(
    `select p.id, p.amount::text, p.currency, p.created_at::text,
            u.name as owner_name, u.email as owner_email,
            coalesce(jsonb_array_length(p.raw -> 'charge_ids'), 0) as lessons
       from payments p
       join users u on u.id = p.user_id
      where p.provider = 'cash' and p.status = 'pending' and p.purpose = 'studio_debt'
      order by p.created_at`,
  );
}

/** Студия подтверждает получение денег: занятия закрываются. */
export async function confirmCash(paymentId: string, actorId: string): Promise<void> {
  await tx(async (c) => {
    const { rows } = await c.query<{
      id: string; user_id: string; status: string; amount: string; currency: string;
      raw: { charge_ids?: string[] } | null;
    }>(
      `select id, user_id, status, amount::text, currency, raw from payments
        where id = $1 and provider = 'cash' and purpose = 'studio_debt' for update`,
      [paymentId],
    );
    const p = rows[0];
    if (!p || p.status !== 'pending') return;

    await c.query(`update payments set status = 'paid' where id = $1`, [p.id]);
    const ids = p.raw?.charge_ids ?? [];
    if (ids.length > 0) {
      await c.query(
        `update charges set payment_id = $1
          where id = any($2::uuid[]) and pass_id is null and payment_id is null`,
        [p.id, ids],
      );
    }
    await logMoneyIn(c, {
      kind: 'cash_confirmed', actorId, ownerId: p.user_id, paymentId: p.id,
      amount: p.amount, currency: p.currency,
      note: `подтверждено получение наличных за ${ids.length} ${plural(ids.length, 'занятие', 'занятия', 'занятий')}`,
    });
  });
}

export async function declineCash(paymentId: string, actorId: string): Promise<void> {
  await tx(async (c) => {
    const { rows } = await c.query<{ id: string; user_id: string; status: string; amount: string; currency: string }>(
      `select id, user_id, status, amount::text, currency from payments
        where id = $1 and provider = 'cash' and purpose = 'studio_debt' for update`,
      [paymentId],
    );
    const p = rows[0];
    if (!p || p.status !== 'pending') return;
    await c.query(`update payments set status = 'failed' where id = $1`, [p.id]);
    await logMoneyIn(c, {
      kind: 'cash_declined', actorId, ownerId: p.user_id, paymentId: p.id,
      amount: p.amount, currency: p.currency, note: 'заявка на оплату наличными отклонена',
    });
  });
}

/** Заявка родителя, которая ещё ждёт подтверждения. */
export async function myPendingCash(userId: string): Promise<CashClaim | null> {
  return one<CashClaim>(
    `select p.id, p.amount::text, p.currency, p.created_at::text,
            u.name as owner_name, u.email as owner_email,
            coalesce(jsonb_array_length(p.raw -> 'charge_ids'), 0) as lessons
       from payments p join users u on u.id = p.user_id
      where p.user_id = $1 and p.provider = 'cash'
        and p.status = 'pending' and p.purpose = 'studio_debt'
      order by p.created_at desc limit 1`,
    [userId],
  );
}
