const { google } = require('googleapis');

const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = 'info@re-create.art';

async function getSheet() {
  const auth = new google.auth.GoogleAuth({
    credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  const sheets = google.sheets({ version: 'v4', auth });
  return sheets;
}

async function sendEmail({ to, name, paymentMethod }) {
  const isRu = paymentMethod === 'ru';
  const subject = isRu
    ? 'Ваша заявка на курс по вышивке принята'
    : 'Your embroidery course application received';

  const html = isRu ? `
    <div style="font-family: Georgia, serif; max-width: 560px; margin: 0 auto; color: #1a1a2e;">
      <h2 style="font-weight: 300; font-size: 28px; margin-bottom: 8px;">Привет, ${name}!</h2>
      <p style="color: #666; line-height: 1.8;">Ваша заявка на онлайн-курс <strong>«Как вышить в современном мире»</strong> принята.</p>
      <p style="color: #666; line-height: 1.8;">Сейчас вы будете переадресованы на страницу оплаты ЮKassa. После успешной оплаты вы получите письмо с инструкциями по доступу к курсу.</p>
      <p style="color: #666; line-height: 1.8;">Если у вас возникли вопросы — напишите нам: <a href="mailto:info@re-create.art" style="color: #e91e8c;">info@re-create.art</a></p>
      <hr style="border: none; border-top: 1px solid #f0e0e8; margin: 32px 0;">
      <p style="font-size: 12px; color: #aaa;">Re.Create.Art · Варя Перлина · re-create.art</p>
    </div>
  ` : `
    <div style="font-family: Georgia, serif; max-width: 560px; margin: 0 auto; color: #1a1a2e;">
      <h2 style="font-weight: 300; font-size: 28px; margin-bottom: 8px;">Hello, ${name}!</h2>
      <p style="color: #666; line-height: 1.8;">Your application for the online course <strong>"How to Embroider in the Modern World"</strong> has been received.</p>
      <p style="color: #666; line-height: 1.8;">You will now be redirected to the Paddle payment page. Once payment is confirmed, you'll receive an email with course access instructions.</p>
      <p style="color: #666; line-height: 1.8;">If you have any questions, contact us: <a href="mailto:info@re-create.art" style="color: #e91e8c;">info@re-create.art</a></p>
      <hr style="border: none; border-top: 1px solid #f0e0e8; margin: 32px 0;">
      <p style="font-size: 12px; color: #aaa;">Re.Create.Art · Varya Perlin · re-create.art</p>
    </div>
  `;

  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: FROM_EMAIL, to, subject, html }),
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { name, email, telegram, paymentMethod } = req.body;

  if (!name || !email || !telegram || !paymentMethod) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    // 1. Save to Google Sheets
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
          paymentMethod === 'ru' ? 'ЮKassa (Россия)' : paymentMethod === 'ils' ? 'Paddle (Израиль · ₪)' : 'Paddle (International · $)',
          'ожидает оплаты',
        ]],
      },
    });

    // 2. Send confirmation email
    await sendEmail({ to: email, name, paymentMethod });

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('submit error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
}
