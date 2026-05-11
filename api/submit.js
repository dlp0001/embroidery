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

  const { name, email, telegram, paymentMethod } = req.body;

  if (!name || !email || !telegram || !paymentMethod) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const sheets = await getSheet();
    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: 'A:F',
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [[
          new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' }),
          name,
          email,
          telegram,
          paymentMethod === 'ru'
            ? 'ЮKassa (Россия)'
            : paymentMethod === 'ils'
            ? 'Paddle (Израиль · ₪)'
            : 'Paddle (International · $)',
          'ожидает оплаты',
        ]],
      },
    });

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('submit error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
}
