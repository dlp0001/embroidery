import { clientIp, getSheet, SHEET_ID } from '@/lib/sheets';

export const runtime = 'nodejs';
export const maxDuration = 10;

export async function POST(req: Request) {
  const { name, email, telegram, paymentMethod, transactionId, amount, currency } =
    (await req.json()) as Record<string, string>;

  if (!name || !email || !telegram || !paymentMethod) {
    return Response.json({ error: 'Missing required fields' }, { status: 400 });
  }

  const rowAmount = amount || (paymentMethod === 'ils' ? '300' : '100');
  const rowCurrency = currency || (paymentMethod === 'ils' ? 'ILS' : 'USD');

  try {
    const sheets = await getSheet();

    if (transactionId) {
      // Оплата прошла — дописываем идентификатор в уже созданную строку.
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: 'A:I',
      });
      const rows = response.data.values ?? [];
      let rowIndex = -1;
      for (let i = rows.length - 1; i >= 1; i--) {
        if (rows[i][2]?.trim().toLowerCase() === email.trim().toLowerCase() && !rows[i][6]) {
          rowIndex = i;
          break;
        }
      }
      console.log('updating row for transaction_id:', rowIndex, transactionId);
      if (rowIndex > 0) {
        await sheets.spreadsheets.values.update({
          spreadsheetId: SHEET_ID,
          range: `G${rowIndex + 1}`,
          valueInputOption: 'USER_ENTERED',
          requestBody: { values: [[transactionId]] },
        });
      }
    } else if (paymentMethod !== 'ru') {
      // Заявка до оплаты. Для 'ru' строку создаёт create-payment-ru.
      await sheets.spreadsheets.values.append({
        spreadsheetId: SHEET_ID,
        range: 'A:O',
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values: [[
            new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' }),
            name, email, telegram,
            paymentMethod === 'ils' ? 'Polar (Израиль · ₪)' : 'Polar (International · $)',
            'ожидает оплаты', '',
            rowAmount, rowCurrency,
            '', '', '', '',
            clientIp(req), req.headers.get('user-agent') ?? '',
          ]],
        },
      });
    }

    return Response.json({ success: true });
  } catch (err) {
    console.error('submit error:', err);
    return Response.json({ error: 'Server error' }, { status: 500 });
  }
}
