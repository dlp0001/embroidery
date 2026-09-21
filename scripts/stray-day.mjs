// Лишний день смены: тот, что остался в расписании после правки дат.
// Показывает, пустой ли он, и с --apply убирает — но только пустой.
import pg from 'pg';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const allowRemote = args.includes('--allow-remote');
const day = args.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a));
if (!day) { console.error('нужна дата: 2026-09-21'); process.exit(1); }

const url = process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL не задан'); process.exit(1); }
const host = new URL(url).hostname;
const local = host === 'localhost' || host === '127.0.0.1';
if (!local && !allowRemote) {
  console.error(`База не локальная (${host}). Нужен флаг --allow-remote.`);
  process.exit(1);
}

const c = new pg.Client(local ? { connectionString: url } : { connectionString: url, ssl: { rejectUnauthorized: true } });
await c.connect();
await c.query("set time zone 'Asia/Jerusalem'");

const { rows } = await c.query(
  `select s.id, g.title, g.kind, s.status, g.starts_on::text, g.ends_on::text,
          (select count(*)::int from attendance a where a.session_id = s.id) as marked,
          (select count(*)::int from charges ch where ch.session_id = s.id) as charged,
          (select count(*)::int from bookings b
            where b.session_id = s.id and b.status = 'booked') as booked
     from studio_sessions s join studio_groups g on g.id = s.group_id
    where s.held_on = $1::date and g.kind <> 'lesson'`,
  [day],
);

if (rows.length === 0) { console.log(`на ${day} дней смены нет`); await c.end(); process.exit(0); }

for (const r of rows) {
  const empty = r.marked === 0 && r.charged === 0 && r.booked === 0;
  console.log(`${day}: ${r.title} (период ${r.starts_on} — ${r.ends_on}), ${r.status}`);
  console.log(`  отметок ${r.marked}, начислений ${r.charged}, записей ${r.booked} → ${empty ? 'пустой' : 'НЕ пустой, не трогаю'}`);
  if (apply && empty) {
    await c.query('delete from studio_sessions where id = $1', [r.id]);
    console.log('  убран');
  }
}
if (!apply) console.log('\nповторите с --apply, чтобы убрать пустые');
await c.end();
