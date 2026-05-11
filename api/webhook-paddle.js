const { google } = require('googleapis');
const crypto = require('crypto');

const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const PADDLE_WEBHOOK_SECRET = process.env.PADDLE_WEBHOOK_SECRET;
const FROM_EMAIL = 'info@re-create.art';

module.exports.config = {
  api: { bodyParser: false },
};

async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

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
    range: 'A:F',
  });
  const rows = response.data.values || [];
  const rowIndex = rows.findIndex(row => row[2] === email);
  if (rowIndex > 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `F${rowIndex + 1}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [['оплачено ✓']] },
    });
  }
}

function emailHtml() {
  return `
    <div style="font-family: Georgia,'Times New Roman',serif;max-width:560px;margin:0 auto;color:#1a1a2e;background:#ffffff;">
      <div style="background:#1a1a2e;padding:32px 48px;text-align:center;">
        <div style="font-size:11px;letter-spacing:0.3em;text-transform:uppercase;color:#e91e8c;margin-bottom:8px;font-family:sans-serif;">Re.Create.Art</div>
        <div style="font-size:20px;font-weight:300;color:#ffffff;letter-spacing:0.05em;">Варя Перлина</div>
      </div>
      <div style="padding:40px 48px 28px;">
        <p style="font-size:24px;font-weight:300;color:#1a1a2e;margin:0 0 24px;line-height:1.3;">Привет!</p>
        <p style="font-size:15px;color:#444;line-height:1.85;margin:0 0 18px;">Я очень рада видеть тебя в нашей вышивальной компании 💌</p>
        <p style="font-size:15px;color:#444;line-height:1.85;margin:0 0 20px;">Вот ссылки для доступа к курсу:</p>
        <div style="background:#f5f0fa;border-left:3px solid #e91e8c;padding:18px 22px;margin:0 0 24px;">
          <div style="margin-bottom:14px;">
            <div style="font-size:10px;letter-spacing:0.2em;text-transform:uppercase;color:#999;margin-bottom:6px;font-family:sans-serif;">Канал курса</div>
            <a href="https://t.me/+lt4Nz2MoMfBiNDMy" style="color:#e91e8c;font-size:14px;text-decoration:none;">→ Открыть канал</a>
          </div>
          <div>
            <div style="font-size:10px;letter-spacing:0.2em;text-transform:uppercase;color:#999;margin-bottom:6px;font-family:sans-serif;">Общий чат</div>
            <a href="https://t.me/+1MeRoRhGoiI2ODJi" style="color:#e91e8c;font-size:14px;text-decoration:none;">→ Открыть чат</a>
          </div>
        </div>
        <p style="font-size:15px;color:#444;line-height:1.85;margin:0 0 18px;">Совсем скоро там появится полный список всех материалов и инструментов, которые понадобятся для курса, — и можно будет постепенно собрать всё необходимое к старту.</p>
        <p style="font-size:15px;color:#444;line-height:1.85;margin:0 0 32px;">Впереди много красивого, уютного и вдохновляющего — и мне уже не терпится всё это начать вместе ✨</p>
        <div style="border-top:1px solid #f0e0e8;padding-top:24px;">
          <div style="font-size:17px;font-weight:300;color:#1a1a2e;margin-bottom:4px;">Варя Перлина</div>
          <div style="font-size:11px;color:#999;letter-spacing:0.1em;font-family:sans-serif;">re-create.art</div>
        </div>
      </div>
      <div style="background:#f5f0fa;padding:18px 48px;text-align:center;">
        <p style="font-size:11px;color:#aaa;margin:0;line-height:1.7;font-family:sans-serif;">
          Это письмо отправлено автоматически после подтверждения оплаты.<br>
          Вопросы: <a href="mailto:info@re-create.art" style="color:#e91e8c;text-decoration:none;">info@re-create.art</a>
        </p>
      </div>
    </div>
  `;
}

async function sendEmail(to) {
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to,
      subject: 'Добро пожаловать на курс по вышивке ✨',
      html: emailHtml(),
    }),
  });
  const data = await r.json();
  console.log('resend response:', data);
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const rawBody = await getRawBody(req);
  const signature = req.headers['paddle-signature'];

  if (!signature) return res.status(401).json({ error: 'No signature' });

  try {
    const parts = {};
    signature.split(';').forEach(p => {
      const idx = p.indexOf('=');
      parts[p.slice(0, idx)] = p.slice(idx + 1);
    });
    const { ts, h1 } = parts;
    const signed = `${ts}:${rawBody}`;
    const expected = crypto.createHmac('sha256', PADDLE_WEBHOOK_SECRET).update(signed).digest('hex');
    if (expected !== h1) {
      console.error('signature mismatch', { expected, h1 });
      return res.status(401).json({ error: 'Invalid signature' });
    }
  } catch (e) {
    console.error('signature error:', e);
    return res.status(401).json({ error: 'Signature error' });
  }

  const event = JSON.parse(rawBody);
  console.log('paddle event:', event.event_type);

  if (event.event_type !== 'transaction.completed') {
    return res.status(200).json({ received: true });
  }

  const email = event.data?.customer?.email;
  console.log('customer email:', email);
  if (!email) return res.status(200).json({ received: true });

  try {
    await updateSheet(email, 'оплачено ✓');
    await sendEmail(email);
    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('paddle webhook error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
}
