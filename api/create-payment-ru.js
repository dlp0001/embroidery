const { v4: uuidv4 } = require('uuid');
const { google } = require('googleapis');

const YOOKASSA_SHOP_ID = '1351165';
const YOOKASSA_API_KEY = process.env.YOOKASSA_API_KEY;
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

  const { name, email, telegram, consentData, consentMarketing, userAgent } = req.body;

  if (!name || !email || !telegram) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const idempotenceKey = uuidv4();
    const credentials = Buffer.from(`${YOOKASSA_SHOP_ID}:${YOOKASSA_API_KEY}`).toString('base64');

    const response = await fetch('https://api.yookassa.ru/v3/payments', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type': 'application/json',
        'Idempotence-Key': idempotenceKey,
      },
      body: JSON.stringify({
        amount: { value: '6000.00', currency: 'RUB' },
        confirmation: {
          type: 'redirect',
          return_url: 'https://re-create.art/?success=true',
        },
        capture: true,
        description: 'Онлайн курс по вышивке «Как вышить в современном мире»',
        receipt: {
          customer: { email },
          items: [{
            description: 'Онлайн курс по вышивке «Как вышить в современном мире»',
            quantity: '1.00',
            amount: { value: '6000.00', currency: 'RUB' },
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
      return res.status(500).json({ error: 'Payment creation failed' });
    }

    // Get IP from request headers
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || '';

    // Save to Sheets WITH all consent fields
    const sheets = await getSheet();
    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: 'A:O',
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [[
          new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' }), // A - Дата
          name,                                   // B - Имя
          email,                                  // C - Email
          telegram,                               // D - Telegram
          'ЮKassa (Россия)',                      // E - Способ оплаты
          'ожидает оплаты',                       // F - Статус
          payment.id,                             // G - Payment ID
          '6000',                                 // H - Сумма
          'RUB',                                  // I - Валюта
          consentData ? 'да' : 'нет',             // J - Согласие на ПД
          '1.0',                                  // K - Версия документа ПД
          consentMarketing ? 'да' : 'нет',        // L - Согласие на рассылку
          '1.0',                                  // M - Версия документа рассылки
          ip,                                     // N - IP адрес
          userAgent || '',                        // O - User Agent
        ]],
      },
    });

    console.log('saved to sheets with payment_id:', payment.id);

    return res.status(200).json({
      success: true,
      paymentUrl: payment.confirmation.confirmation_url,
      paymentId: payment.id,
    });

  } catch (err) {
    console.error('yookassa create error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};
