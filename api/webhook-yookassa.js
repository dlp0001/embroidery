const { google } = require('googleapis');
const crypto = require('crypto');

const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const YOOKASSA_SECRET = process.env.YOOKASSA_WEBHOOK_SECRET;
const FROM_EMAIL = 'info@re-create.art';

async function getSheet() {
  const auth = new google.auth.GoogleAuth({
    credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth });
}

async function updateSheet(email, status) {
  const sheets = await getSheet();
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: 'Sheet1!A:F',
  });
  const rows = response.data.values || [];
  const rowIndex = rows.findIndex(row => row[2] === email);
  if (rowIndex > 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `Sheet1!F${rowIndex + 1}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [[status]] },
    });
  }
}

async function sendSuccessEmail({ to, name }) {
  const html = `
    <div style="font-family: Georgia, serif; max-width: 560px; margin: 0 auto; color: #1a1a2e;">
      <h2 style="font-weight: 300; font-size: 28px; margin-bottom: 8px;">Привет, ${name}! 🎉</h2>
      <p style="color: #666; line-height: 1.8;">Оплата подтверждена! Добро пожаловать на курс по вышивке <strong>«Как вышить в современном мире»</strong>.</p>
      <p style="color: #666; line-height: 1.8;">Мы скоро добавим вас в Telegram-группу курса. Убедитесь, что ваш ник в Telegram указан верно.</p>
      <div style="background: #f5f0fa; border-left: 3px solid #e91e8c; padding: 16px 20px; margin: 24px 0;">
        <p style="margin: 0; color: #1a1a2e; font-size: 14px;">
          <strong>Старт курса:</strong> 2 июня 2025, 21:00 (московское время)<br>
          <strong>Платформа:</strong> Zoom + Telegram<br>
          <strong>Вопросы:</strong> info@re-create.art
        </p>
      </div>
      <p style="color: #666; line-height: 1.8;">До встречи на курсе! 🧵</p>
      <hr style="border: none; border-top: 1px solid #f0e0e8; margin: 32px 0;">
      <p style="font-size: 12px; color: #aaa;">Re.Create.Art · Варя Перлина · re-create.art</p>
    </div>
  `;

  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to,
      subject: 'Оплата подтверждена — добро пожаловать на курс! 🧵',
      html,
    }),
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // ЮKassa sends IP from their range — verify shared secret in header
  const authHeader = req.headers['authorization'] || '';
  const expectedAuth = `Basic ${Buffer.from(YOOKASSA_SECRET).toString('base64')}`;
  if (authHeader !== expectedAuth) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const event = req.body;

  // Only handle successful payments
  if (event.event !== 'payment.succeeded') {
    return res.status(200).json({ received: true });
  }

  const payment = event.object;
  const email = payment?.metadata?.email;
  const name  = payment?.metadata?.name || 'Участник';

  if (!email) {
    console.error('No email in payment metadata');
    return res.status(200).json({ received: true });
  }

  try {
    await updateSheet(email, 'оплачено ✓');
    await sendSuccessEmail({ to: email, name });
    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('yookassa webhook error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
}
