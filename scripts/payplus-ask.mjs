// Спрашивает PayPlus про зависшие платежи: прошли они на самом деле или нет.
// Только чтение: ничего не меняет ни у нас, ни у них.
// Запуск: node --env-file-if-exists=.env.production.local scripts/payplus-ask.mjs
import pg from 'pg';

const mode = process.env.PAYPLUS_ENV === 'prod' ? 'prod' : 'test';
const base = mode === 'prod'
  ? 'https://restapi.payplus.co.il/api/v1.0'
  : 'https://restapidev.payplus.co.il/api/v1.0';
const apiKey = (process.env.PAYPLUS_API_KEY ?? '').trim();
const secretKey = (process.env.PAYPLUS_SECRET_KEY ?? '').trim();
if (!apiKey || !secretKey) { console.error('нужны ключи PayPlus'); process.exit(1); }

const url = process.env.DATABASE_URL;
const host = new URL(url).hostname;
const local = host === 'localhost' || host === '127.0.0.1';
const c = new pg.Client(local ? { connectionString: url } : { connectionString: url, ssl: { rejectUnauthorized: true } });
await c.connect();
await c.query("set time zone 'Asia/Jerusalem'");

const { rows } = await c.query(
  `select p.id, p.provider_id, p.amount::text, p.created_at::text as started,
          coalesce(u.name, u.email) as who, p.purpose, p.raw ->> 'group_title' as pack
     from payments p left join users u on u.id = p.user_id
    where p.status = 'pending' and p.provider = 'payplus' and p.provider_id is not null
    order by p.created_at`,
);

console.log(`среда: ${mode}, зависших платежей: ${rows.length}\n`);
for (const r of rows) {
  const res = await fetch(`${base}/PaymentPages/ipn`, {
    method: 'POST',
    headers: { 'api-key': apiKey, 'secret-key': secretKey, 'content-type': 'application/json' },
    // Имена идентификатора у PayPlus плавают — кладём оба, как в коде.
    body: JSON.stringify({ page_request_uid: r.provider_id, payment_request_uid: r.provider_id }),
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = null; }
  const d = data?.data;
  const status = d?.status_code === '000' || d?.status === 'approved' ? 'ОПЛАЧЕН' : (d?.status ?? data?.results?.status ?? 'нет ответа');
  console.log(`${r.started}  ${r.who}  ${r.amount} ₪${r.pack ? ` · ${r.pack}` : ''}`);
  console.log(`   PayPlus говорит: ${status}${d?.status_code ? ` (код ${d.status_code})` : ''}`);
  if (d?.date) console.log(`   дата операции: ${d.date}`);
  if (process.argv.includes('--raw')) console.log('   ответ:', text.slice(0, 400));
}
await c.end();
