import { randomUUID } from 'node:crypto';
import { clientIp, getSheet, SHEET_ID } from '@/lib/sheets';

export const runtime = 'nodejs';
export const maxDuration = 10;

const YOOKASSA_SHOP_ID = '1351165';
const PRICE = '400.00';
const DESCRIPTION = 'Список материалов и инструментов для вышивки';

export async function POST(req: Request) {
  const { name, email, telegram, consentData, consentMarketing, userAgent } =
    (await req.json()) as Record<string, string | boolean>;

  if (!name || !email || !telegram) {
    return Response.json({ error: 'Missing required fields' }, { status: 400 });
  }

  try {
    const credentials = Buffer.from(
      `${YOOKASSA_SHOP_ID}:${process.env.YOOKASSA_API_KEY}`,
    ).toString('base64');

    const response = await fetch('https://api.yookassa.ru/v3/payments', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/json',
        'Idempotence-Key': randomUUID(),
      },
      body: JSON.stringify({
        amount: { value: PRICE, currency: 'RUB' },
        confirmation: {
          type: 'redirect',
          return_url: 'https://re-create.art/embroidery?success=true',
        },
        capture: true,
        description: DESCRIPTION,
        receipt: {
          customer: { email },
          items: [{
            description: DESCRIPTION,
            quantity: '1.00',
            amount: { value: PRICE, currency: 'RUB' },
            vat_code: 1,
            payment_mode: 'full_payment',
            payment_subject: 'service',
          }],
        },
        metadata: { email, name, telegram },
      }),
    });

    const payment = await response.json();
    console.log('yookassa payment created:', payment.id, payment.status);

    if (!payment.confirmation?.confirmation_url) {
      console.error('no confirmation url:', payment);
      return Response.json({ error: 'Payment creation failed' }, { status: 500 });
    }

    const sheets = await getSheet();
    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: 'A:O',
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [[
          new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' }),
          name, email, telegram,
          'ЮKassa (Россия)', 'ожидает оплаты', payment.id,
          '400', 'RUB',
          consentData ? 'да' : 'нет', '1.0',
          consentMarketing ? 'да' : 'нет', '1.0',
          clientIp(req), userAgent || '',
        ]],
      },
    });
    console.log('saved to sheets with payment_id:', payment.id);

    return Response.json({
      success: true,
      paymentUrl: payment.confirmation.confirmation_url,
      paymentId: payment.id,
    });
  } catch (err) {
    console.error('yookassa create error:', err);
    return Response.json({ error: 'Server error' }, { status: 500 });
  }
}
