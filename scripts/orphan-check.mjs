// Почему «детей без родителя» и «непосчитанных посещений» разное число.
// Только чтение.
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
    `select ch.name,
            (select count(*)::int from attendance a
              where a.participant_id = p.id and a.status = 'present') as visits,
            (select count(*)::int from charges x
              where x.participant_id = p.id) as charges,
            (select count(*)::int from charges x
              where x.participant_id = p.id and x.owner_id is null and x.payment_id is null) as unbilled
       from children ch
       join participants p on p.child_id = ch.id
      where ch.archived_at is null
        and not exists (select 1 from guardians g where g.child_id = ch.id)
      order by ch.name`);
  console.log('Дети без родителя:');
  for (const r of rows) {
    console.log(`  ${r.name}: посещений ${r.visits}, начислений ${r.charges}, не посчитано ${r.unbilled}`);
  }

  const { rows: [n] } = await c.query(
    `select (select count(*)::int from charges where owner_id is null and payment_id is null) as by_charges,
            (select count(*)::int from attendance a
               join participants p on p.id = a.participant_id
               join children ch on ch.id = p.child_id
              where a.status = 'present'
                and not exists (select 1 from guardians g where g.child_id = ch.id)) as by_visits`);
  console.log(`\nСчёт по начислениям: ${n.by_charges}`);
  console.log(`Счёт по посещениям:  ${n.by_visits}`);
} finally {
  await c.end();
}
