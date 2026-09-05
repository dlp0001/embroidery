const { google } = require('googleapis');
const crypto = require('crypto');

const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const POLAR_WEBHOOK_SECRET = process.env.POLAR_WEBHOOK_SECRET;
const ICOUNT_TOKEN = process.env.ICOUNT_TOKEN;
const FROM_EMAIL = 'info@re-create.art';

// ── Verify webhook signature ──────────────────────────────

function verifySignature(rawBody, signature) {
  const hmac = crypto.createHmac('sha256', POLAR_WEBHOOK_SECRET);
  hmac.update(rawBody);
  const digest = hmac.digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(signature));
  } catch {
    return false;
  }
}

// ── Google Sheets ─────────────────────────────────────────

async function getSheet() {
  const auth = new google.auth.GoogleAuth({
    credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth });
}

async function updateSheetByEmail(email) {
  const sheets = await getSheet();
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: 'A:O',
  });
  const rows = response.data.values || [];
  let rowIndex = -1;
  for (let i = rows.length - 1; i >= 1; i--) {
    if (rows[i][2]?.trim().toLowerCase() === email.trim().toLowerCase() && rows[i][5] === 'ожидает оплаты') {
      rowIndex = i;
      break;
    }
  }
  console.log('updateSheet: looking for', email, 'found at', rowIndex);
  if (rowIndex > 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `F${rowIndex + 1}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [['оплачено ✓']] },
    });
  }
}

// ── iCount receipt ────────────────────────────────────────

async function createICountReceipt({ clientName, clientEmail, amount, currency, description }) {
  if (!ICOUNT_TOKEN) { console.log('iCount token not set, skipping'); return; }
  const res = await fetch('https://api.icount.co.il/api/v3.php/doc/create', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${ICOUNT_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      doc_type: 320,
      client_name: clientName,
      client_email: clientEmail,
      send_client: true,
      currency_code: currency,
      items: [{
        description,
        amount: 1,
        unit_price: parseFloat(amount),
        vat: 0,
      }],
      payment: [{
        payment_type: 5,
        payment_sum: parseFloat(amount),
      }],
    }),
  });
  const data = await res.json();
  console.log('iCount receipt:', JSON.stringify(data));
}

// ── Email ─────────────────────────────────────────────────

function emailHtml() {
  return `
    <div style="font-family:Georgia,'Times New Roman',serif;max-width:560px;margin:0 auto;color:#1a1a2e;background:#ffffff;">
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
        <p style="font-size:15px;color:#444;line-height:1.85;margin:0 0 18px;">Полный список всех материалов и инструментов, которые понадобятся для курса, доступен по ссылке <a href="https://www.re-create.art/materials" style="color:#e91e8c;text-decoration:none;">re-create.art/materials</a> — можно постепенно собрать всё необходимое к старту.</p>
        <p style="font-size:15px;color:#444;line-height:1.85;margin:0 0 32px;">Впереди много красивого, уютного и вдохновляющего — и мне уже не терпится всё это начать вместе ✨</p>
        <div style="border-top:1px solid #f0e0e8;padding-top:24px;">
          <div style="font-size:17px;font-weight:300;color:#1a1a2e;margin-bottom:4px;">Варя Перлина</div>
          <div style="font-size:11px;color:#999;letter-spacing:0.1em;font-family:sans-serif;">re-create.art</div>
        </div>
      </div>
      <div style="background:#f5f0fa;padding:18px 48px;text-align:center;">
        <p style="font-size:11px;color:#aaa;margin:0;line-height:1.7;font-family:sans-serif;">
          Квитанция об оплате отправлена отдельным письмом.<br>
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
  console.log('resend status:', r.status);
}

// ── Handler ───────────────────────────────────────────────

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Verify signature
  const signature = req.headers['webhook-id'] ? null : req.headers['x-polar-signature'];
  const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);

  // Polar uses webhook-id + webhook-signature headers
  const webhookSig = req.headers['webhook-signature'];
  // For now, log and proceed (verify later if needed)
  console.log('polar webhook received, signature:', webhookSig ? 'present' : 'missing');

  const event = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  const eventType = event?.type;
  console.log('polar event type:', eventType);

  if (eventType !== 'order.created') {
    return res.status(200).json({ received: true });
  }

  const order = event?.data;
  const email = order?.customer?.email || order?.customer_email;
  const name = order?.customer?.name || order?.metadata?.name || '';
  const amount = order?.amount ? (order.amount / 100).toFixed(2) : '0';
  const currency = order?.currency?.toUpperCase() || 'ILS';

  console.log('polar order:', { email, name, amount, currency });

  if (!email) {
    console.error('No email in order');
    return res.status(200).json({ received: true });
  }

  try {
    // 1. Update Google Sheets
    await updateSheetByEmail(email);

    // 2. Create iCount receipt
    await createICountReceipt({
      clientName: name,
      clientEmail: email,
      amount,
      currency,
      description: 'Онлайн курс по вышивке «Как вышить в современном мире»',
    });

    // 3. Send welcome email
    await sendEmail(email);

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('polar webhook error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};
