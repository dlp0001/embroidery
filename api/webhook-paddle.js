const { google } = require('googleapis');
const crypto = require('crypto');

const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const PADDLE_WEBHOOK_SECRET = process.env.PADDLE_WEBHOOK_SECRET;
const FROM_EMAIL = 'info@re-create.art';

async function getSheet() {
  const auth = new google.auth.GoogleAuth({
    credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth });
}

function verifyPaddleSignature(req, secret) {
  const signature = req.headers['paddle-signature'];
  if (!signature) return false;
  const parts = Object.fromEntries(signature.split(';').map(p => p.split('=')));
  const ts = parts['ts'];
  const h1 = parts['h1'];
  const signed = `${ts}:${JSON.stringify(req.body)}`;
  const expected = crypto.createHmac('sha256', secret).update(signed).digest('hex');
  return expected === h1;
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
      <h2 style="font-weight: 300; font-size: 28px; margin-bottom: 8px;">Hello, ${name}! 🎉</h2>
      <p style="color: #666; line-height: 1.8;">Your payment has been confirmed! Welcome to the embroidery course <strong>"How to Embroider in the Modern World"</strong>.</p>
      <p style="color: #666; line-height: 1.8;">We will add you to the course Telegram group shortly. Please make sure your Telegram username is correct.</p>
      <div style="background: #f5f0fa; border-left: 3px solid #e91e8c; padding: 16px 20px; margin: 24px 0;">
        <p style="margin: 0; color: #1a1a2e; font-size: 14px;"><strong>Course start:</strong> June 2, 2025 at 9:00 PM Moscow time<br>
        <strong>Platform:</strong> Zoom + Telegram<br>
        <strong>Questions:</strong> info@re-create.art</p>
      </div>
      <p style="color: #666; line-height: 1.8;">See you at the course! 🧵</p>
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
    body: JSON.stringify({
      from: FROM_EMAIL,
      to,
      subject: 'Payment confirmed — welcome to the course! 🧵',
      html,
    }),
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!verifyPaddleSignature(req, PADDLE_WEBHOOK_SECRET)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const event = req.body;
  if (event.event_type !== 'transaction.completed') {
    return res.status(200).json({ received: true });
  }

  const email = event.data?.customer?.email;
  const name  = event.data?.customer?.name || 'Student';

  try {
    await updateSheet(email, 'оплачено ✓');
    await sendSuccessEmail({ to: email, name });
    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('paddle webhook error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
}
