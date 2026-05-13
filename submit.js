const { google } = require('googleapis');

const SHEET_ID = process.env.GOOGLE_SHEET_ID;

async function getSheet() {
  const auth = new google.auth.GoogleAuth({
    credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth });
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { name, email, telegram, paymentMethod, transactionId } = req.body;

  // Get IP from request headers
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || '';

  if (!name || !email || !telegram || !paymentMethod) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const sheets = await getSheet();

    if (transactionId) {
      // Paddle checkout completed — find existing row and update transaction_id
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: 'A:I',
      });
      const rows = response.data.values || [];
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
      // Initial form submission for Paddle — create new row
      // (for 'ru', row is created by create-payment-ru.js with payment_id)
      await sheets.spreadsheets.values.append({
        spreadsheetId: SHEET_ID,
        range: 'A:O',
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values: [[
            new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' }), // A - Дата
            name,                                          // B - Имя
            email,                                         // C - Email
            telegram,                                      // D - Telegram
            paymentMethod === 'ils'
              ? 'Paddle (Израиль · ₪)'
              : 'Paddle (International · $)',              // E - Способ оплаты
            'ожидает оплаты',                              // F - Статус
            '',                                            // G - Payment ID (заполнится позже)
            paymentMethod === 'ils' ? '240' : '80',        // H - Сумма
            paymentMethod === 'ils' ? 'ILS' : 'USD',       // I - Валюта
            '',                                            // J - Согласие на ПД
            '',                                            // K - Версия ПД
            '',                                            // L - Согласие на рассылку
            '',                                            // M - Версия рассылки
            ip,                                            // N - IP адрес
            req.headers['user-agent'] || '',               // O - User Agent
          ]],
        },
      });
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('submit error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};
