export const runtime = 'nodejs';

const YOOKASSA_SHOP_ID = '1351165';

export async function GET(req: Request) {
  const paymentId = new URL(req.url).searchParams.get('paymentId');
  if (!paymentId) return Response.json({ error: 'Missing paymentId' }, { status: 400 });

  try {
    const credentials = Buffer.from(
      `${YOOKASSA_SHOP_ID}:${process.env.YOOKASSA_API_KEY}`,
    ).toString('base64');
    const res = await fetch(`https://api.yookassa.ru/v3/payments/${paymentId}`, {
      headers: { Authorization: `Basic ${credentials}` },
    });
    const payment = await res.json();
    console.log('payment status check:', payment.id, payment.status);
    return Response.json({ status: payment.status });
  } catch (err) {
    console.error('check payment error:', err);
    return Response.json({ error: 'Server error' }, { status: 500 });
  }
}
