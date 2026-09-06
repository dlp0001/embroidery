// Что случилось с последними платежами: только чтение, ничего не меняет.
// Запуск: npm run payments        (локальная база)
//         npm run payments:prod   (боевая)
import pg from 'pg';

const url = process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL не задан'); process.exit(1); }

function pgConfig(connectionString) {
  let local = false;
  try {
    const host = new URL(connectionString).hostname;
    local = host === 'localhost' || host === '127.0.0.1';
  } catch {}
  return local ? { connectionString } : { connectionString, ssl: { rejectUnauthorized: true } };
}

const limit = Number(process.argv[2] ?? 8);
const c = new pg.Client(pgConfig(url));
await c.connect();
try {
  const { rows: pays } = await c.query(
    `select p.id, p.provider, p.purpose, p.status, p.amount::text, p.currency,
            p.provider_id, p.created_at::text, u.email,
            (p.raw ->> 'lessons') as lessons
       from payments p left join users u on u.id = p.user_id
      order by p.created_at desc limit $1`, [limit]);

  console.log('Последние платежи:');
  for (const p of pays) {
    console.log(`  ${p.created_at.slice(0, 19)} · ${p.provider}/${p.purpose} · ${p.status} · ${p.amount} ${p.currency} · ${p.email ?? '—'}`);
    console.log(`    id ${p.id}${p.provider_id ? `  провайдер ${p.provider_id}` : '  провайдер не записан'}`);
  }
  if (pays.length === 0) console.log('  ни одного');

  const { rows: ev } = await c.query(
    `select e.at::text, e.kind, e.note, e.amount::text, e.details ->> 'via' as via
       from money_events e order by e.at desc limit $1`, [limit]);
  console.log('\nПоследние события реестра:');
  for (const e of ev) {
    const via = e.via === 'callback' ? ' · дошло звонком PayPlus'
      : e.via === 'return' ? ' · дотянуто нашей проверкой' : '';
    console.log(`  ${e.at.slice(0, 19)} · ${e.kind} · ${e.amount ?? '—'} · ${e.note ?? ''}${via}`);
  }
  if (ev.length === 0) console.log('  ни одного');

  const { rows: st } = await c.query(
    `select status, count(*)::int as n from payments group by status order by n desc`);
  console.log('\nВсего платежей по состояниям:', st.map((r) => `${r.status}: ${r.n}`).join(', ') || 'нет');
} finally {
  await c.end();
}
