const { v4: uuidv4 } = require('uuid');

const YOOKASSA_SHOP_ID = '1351165';
const YOOKASSA_API_KEY = process.env.YOOKASSA_API_KEY;

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { name, email, telegram } = req.body;

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
        amount: {
          value: '6000.00',
          currency: 'RUB',
        },
        confirmation: {
          type: 'redirect',
          return_url: `https://embroidery-course.vercel.app/?success=true&payment_id=${payment.id}`,
        },
        capture: true,
        description: 'Онлайн курс по вышивке «Как вышить в современном мире»',
        receipt: {
          customer: {
            email,
          },
          items: [
            {
              description: 'Онлайн курс по вышивке «Как вышить в современном мире»',
              quantity: '1.00',
              amount: {
                value: '6000.00',
                currency: 'RUB',
              },
              vat_code: 1,
              payment_mode: 'full_payment',
              payment_subject: 'service',
            },
          ],
        },
        metadata: {
          email,
          name,
          telegram,
        },
      }),
    });

    const payment = await response.json();
    console.log('yookassa payment created:', payment.id, payment.status);

    if (!payment.confirmation?.confirmation_url) {
      console.error('no confirmation url:', payment);
      return res.status(500).json({ error: 'Payment creation failed' });
    }

    // Save to Google Sheets with payment_id
    const { google } = require('googleapis');
    const auth = new google.auth.GoogleAuth({
      credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT),
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    const sheets = google.sheets({ version: 'v4', auth });
    await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: 'A:G',
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [[
          new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' }),
          name,
          email,
          telegram,
          'ЮKassa (Россия)',
          'ожидает оплаты',
          payment.id,
        ]],
      },
    });

    return res.status(200).json({
      success: true,
      paymentUrl: payment.confirmation.confirmation_url,
    });

  } catch (err) {
    console.error('yookassa create error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};
