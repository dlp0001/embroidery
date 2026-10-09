import handler from '@/server/legacy/webhook-yookassa.js';
import { runLegacy } from '@/lib/legacy-handler';
import { fulfil, yookassaPayment } from '@/lib/course-pay';

export const runtime = 'nodejs';
export const maxDuration = 10;
export const dynamic = 'force-dynamic';

/**
 * Оплата курса открывает доступ. Присланному не верим: подписи у ЮKassa
 * нет, поэтому по id переспрашиваем платёж у неё самой и берём сумму,
 * статус и metadata из ответа. Остальные платежи (список материалов со
 * старого лендинга) идут прежним путём.
 */
export async function POST(req: Request) {
  const raw = await req.text();
  let event: { event?: string; object?: { id?: string; metadata?: Record<string, string> } } = {};
  try {
    event = JSON.parse(raw);
  } catch {
    return Response.json({ error: 'bad json' }, { status: 400 });
  }

  if (event.object?.metadata?.course) {
    if (event.event !== 'payment.succeeded' || !event.object.id) return Response.json({ received: true });

    let payment;
    try {
      payment = await yookassaPayment(event.object.id);
    } catch (err) {
      console.error('yookassa course: проверка не прошла', err);
      // Ошибка — чтобы ЮKassa повторила уведомление.
      return Response.json({ error: 'verification failed' }, { status: 500 });
    }
    if (!payment || payment.status !== 'succeeded' || !payment.paid || !payment.id) {
      console.error('yookassa course: платёж не подтвердился', event.object.id, payment?.status);
      return Response.json({ received: true });
    }

    await fulfil({
      provider: 'yookassa',
      providerId: payment.id,
      checkoutId: payment.metadata?.checkout ?? null,
      slug: payment.metadata?.course,
      email: payment.metadata?.email,
      amount: Number(payment.amount?.value),
      currency: payment.amount?.currency ?? null,
      raw: payment,
    });
    return Response.json({ received: true });
  }

  return runLegacy(handler as never, new Request(req.url, { method: 'POST', headers: req.headers, body: raw }));
}
