import { applyPayment } from '@/lib/billing';
import { one } from '@/lib/db';
import { fetchTransaction } from '@/lib/payplus';

export const runtime = 'nodejs';
export const maxDuration = 10;
export const dynamic = 'force-dynamic';

/**
 * PayPlus зовёт этот адрес после платежа. Содержимому вызова мы не верим:
 * берём из него только идентификаторы и переспрашиваем у PayPlus сами.
 */
async function handle(params: {
  pageRequestUid?: string;
  transactionUid?: string;
  reference?: string;
}): Promise<Response> {
  if (!params.pageRequestUid && !params.transactionUid) {
    console.error('payplus callback: нет идентификаторов', params);
    return Response.json({ received: true });
  }

  let check;
  try {
    check = await fetchTransaction({
      pageRequestUid: params.pageRequestUid,
      transactionUid: params.transactionUid,
    });
  } catch (err) {
    console.error('payplus callback: проверка не прошла', err);
    // Отвечаем ошибкой, чтобы PayPlus повторил вызов.
    return Response.json({ error: 'verification failed' }, { status: 500 });
  }

  if (!check.paid) {
    console.log('payplus callback: платёж не прошёл, код', check.statusCode);
    return Response.json({ received: true });
  }

  // Ищем наш платёж: сначала по нашему же идентификатору, потом по uid страницы.
  const reference = check.reference ?? params.reference ?? null;
  const payment =
    (reference
      ? await one<{ id: string; amount: string }>(
          `select id, amount::text from payments where id = $1 and provider = 'payplus'`,
          [reference],
        )
      : null) ??
    (params.pageRequestUid
      ? await one<{ id: string; amount: string }>(
          `select id, amount::text from payments where provider = 'payplus' and provider_id = $1`,
          [params.pageRequestUid],
        )
      : null);

  if (!payment) {
    console.error('payplus callback: платёж не найден', params, reference);
    return Response.json({ received: true });
  }

  // Сумма должна совпасть с той, что мы выставили.
  if (check.amount !== null && Math.abs(check.amount - Number(payment.amount)) > 0.01) {
    console.error('payplus callback: сумма разошлась', check.amount, payment.amount);
    return Response.json({ received: true });
  }

  await applyPayment(payment.id, check.transactionUid, 'callback');
  console.log('payplus: платёж зачтён', payment.id);
  return Response.json({ received: true });
}

function fromQuery(req: Request) {
  const q = new URL(req.url).searchParams;
  return {
    pageRequestUid: q.get('payment_request_uid') ?? q.get('page_request_uid') ?? undefined,
    transactionUid: q.get('transaction_uid') ?? q.get('uid') ?? undefined,
    reference: q.get('more_info') ?? undefined,
  };
}

export async function GET(req: Request) {
  return handle(fromQuery(req));
}

export async function POST(req: Request) {
  const q = fromQuery(req);
  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    // тело может быть пустым: тогда работаем по строке запроса
  }
  const t = (body.transaction ?? body) as Record<string, unknown>;
  return handle({
    pageRequestUid: (t.payment_request_uid as string) ?? q.pageRequestUid,
    transactionUid: (t.uid as string) ?? (t.transaction_uid as string) ?? q.transactionUid,
    reference: (t.more_info as string) ?? q.reference,
  });
}
