import handler from '@/server/legacy/webhook-polar.js';
import { runLegacy } from '@/lib/legacy-handler';
import { fulfil, polarCourse, polarSignatureOk } from '@/lib/course-pay';

export const runtime = 'nodejs';
export const maxDuration = 10;
export const dynamic = 'force-dynamic';

type PolarOrder = {
  id?: string;
  status?: string;
  paid?: boolean;
  currency?: string;
  total_amount?: number;
  metadata?: Record<string, unknown>;
  product_id?: string;
  product?: { id?: string };
  customer?: { email?: string; name?: string };
  customer_email?: string;
};

/**
 * Заказы курса открывают доступ — только с верной подписью Polar, иначе
 * курс мог бы выдать себе кто угодно. Остальные заказы (список материалов
 * со старого лендинга) идут прежним путём, без изменений.
 *
 * Тело читаем текстом до всякого разбора: подпись считается от сырых байт.
 */
export async function POST(req: Request) {
  const raw = await req.text();
  const signed = polarSignatureOk(raw, req.headers);

  let event: { type?: string; data?: PolarOrder } = {};
  try {
    event = JSON.parse(raw);
  } catch {
    return Response.json({ error: 'bad json' }, { status: 400 });
  }
  console.log('polar webhook:', event.type, signed ? 'подпись верна' : 'подпись НЕ сошлась');

  const order = event.data ?? {};
  const course = event.type?.startsWith('order.') ? polarCourse(order) : null;

  if (course) {
    if (!signed) return Response.json({ error: 'bad signature' }, { status: 401 });
    const paid = event.type === 'order.paid' || order.status === 'paid' || order.paid === true;
    if (!paid || !order.id) return Response.json({ received: true });

    await fulfil({
      provider: 'polar',
      providerId: order.id,
      checkoutId: course.checkoutId,
      slug: course.slug,
      email: order.customer?.email ?? order.customer_email,
      name: order.customer?.name ?? null,
      // Сумму не сверяем: к цене товара Polar может добавить налог страны
      // покупателя. Сверяем товар — это сделал polarCourse.
      amount: null,
      currency: order.currency?.toUpperCase() ?? null,
      raw: order,
    });
    return Response.json({ received: true });
  }

  // Прежний путь: тело уже прочитано, отдаём старому обработчику копию.
  return runLegacy(handler as never, new Request(req.url, { method: 'POST', headers: req.headers, body: raw }));
}
