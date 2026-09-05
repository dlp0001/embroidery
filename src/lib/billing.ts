import { one, query, tx } from './db';
import { createPaymentLink, isConfigured } from './payplus';
import { lessonPrice } from './studio';

export type Intent =
  | { kind: 'debt' }
  | { kind: 'pass'; lessons: number; months: number };

/**
 * Заводит платёж в состоянии «ждёт» и отдаёт ссылку на страницу PayPlus.
 * Что оплачивается, помним в самой записи: обратный вызов по ней и
 * поймёт, к чему привязать деньги.
 */
export async function startPayment(
  user: { id: string; email: string; name: string | null },
  intent: Intent,
  origin: string,
): Promise<{ url: string } | { error: string }> {
  if (!isConfigured()) return { error: 'Оплата картой ещё не подключена.' };

  const price = await lessonPrice();
  let amount: number;
  let description: string;
  let raw: Record<string, unknown>;

  if (intent.kind === 'debt') {
    const debts = await query<{ id: string; amount: string }>(
      `select id, amount::text from charges
        where owner_id = $1 and pass_id is null and payment_id is null
        order by created_at`,
      [user.id],
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
    [user.id, amount, price.currency, intent.kind === 'debt' ? 'studio_debt' : 'studio_pass',
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
    await query('update payments set provider_id = $2 where id = $1', [payment!.id, link.pageRequestUid]);
    return { url: link.url };
  } catch (err) {
    console.error('payplus: не удалось создать ссылку', err);
    await query(`update payments set status = 'failed' where id = $1`, [payment!.id]);
    return { error: 'Не удалось открыть страницу оплаты. Попробуйте позже.' };
  }
}

/**
 * Отмечает платёж оплаченным и раздаёт то, за что заплатили.
 * Идемпотентно: повторный вызов ничего не меняет.
 */
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

    if (p.purpose === 'studio_debt') {
      const ids = (p.raw?.charge_ids as string[] | undefined) ?? [];
      if (ids.length > 0) {
        await c.query(
          `update charges set payment_id = $1
            where id = any($2::uuid[]) and pass_id is null and payment_id is null`,
          [p.id, ids],
        );
      }
      return;
    }

    if (p.purpose === 'studio_pass') {
      const lessons = Number(p.raw?.lessons ?? 0);
      const months = Number(p.raw?.months ?? 3);
      if (lessons < 1) return;
      await c.query(
        `insert into passes (owner_id, lessons_total, valid_from, valid_to, payment_id)
         values ($1, $2, current_date, current_date + ($3 || ' months')::interval, $4)`,
        [p.user_id, lessons, String(months), p.id],
      );
    }
  });
}
