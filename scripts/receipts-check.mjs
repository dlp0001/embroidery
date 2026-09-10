// Выписались ли квитанции по оплаченным платежам. Только чтение.
//   npm run receipts:prod
import pg from 'pg';

const url = process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL не задан'); process.exit(1); }
let local = false;
try {
  const h = new URL(url).hostname;
  local = h === 'localhost' || h === '127.0.0.1';
} catch {}

const c = new pg.Client(local ? { connectionString: url } : { connectionString: url, ssl: { rejectUnauthorized: true } });
await c.connect();
try {
  const { rows } = await c.query(
    `select p.created_at::text as at, p.provider, p.purpose, p.amount::text,
            coalesce(u.name, u.email) as who,
            p.invoice_url is not null as has_url,
            (p.raw -> 'receipt') is not null as marked,
            (p.raw ->> 'pay_method') as pay_method,
            (p.raw ->> 'receipt_wanted') as wanted
       from payments p left join users u on u.id = p.user_id
      where p.status = 'paid'
      order by p.created_at desc limit 12`);

  for (const r of rows) {
    const state = r.has_url ? 'квитанция есть' : r.marked ? 'выписана, ссылки нет' : 'квитанции нет';
    const why = r.provider === 'cash'
      ? ` · ${r.pay_method ?? 'способ не записан'}, чек ${r.wanted === 'yes' ? 'просили' : 'не просили'}`
      : '';
    console.log(`${r.at.slice(0, 16)} · ${r.provider}/${r.purpose} · ${r.amount} · ${r.who}`);
    console.log(`  ${state}${why}`);
  }
} finally {
  await c.end();
}
