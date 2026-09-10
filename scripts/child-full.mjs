// Полная карточка ребёнка: родители, записи на занятия, посещения,
// начисления и абонементы семьи. Только чтение.
//   npm run child:full -- Агния
import pg from 'pg';

const url = process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL не задан'); process.exit(1); }
const name = process.argv.slice(2).find((a) => !a.startsWith('-'));
if (!name) { console.error('нужно имя: npm run child:full -- Агния'); process.exit(1); }

let local = false;
try {
  const h = new URL(url).hostname;
  local = h === 'localhost' || h === '127.0.0.1';
} catch {}

const c = new pg.Client(local ? { connectionString: url } : { connectionString: url, ssl: { rejectUnauthorized: true } });
await c.connect();
try {
  const { rows: kids } = await c.query(
    `select ch.id, ch.name, ch.archived_at is not null as hidden, p.id as participant_id
       from children ch join participants p on p.child_id = ch.id
      where ch.name ilike $1 order by ch.name`,
    [`%${name}%`]);
  if (kids.length === 0) { console.log('никого не нашлось'); process.exit(0); }

  for (const k of kids) {
    const { rows: par } = await c.query(
      `select coalesce(u.name, u.email) as who from guardians g
         join users u on u.id = g.user_id where g.child_id = $1`, [k.id]);
    console.log(`\n${k.name}${k.hidden ? ' · скрыт' : ''}`);
    console.log(`  родители: ${par.map((x) => x.who).join(', ') || 'нет'}`);

    const { rows: b } = await c.query(
      `select s.held_on::text as day, g.title, b.status
         from bookings b join studio_sessions s on s.id = b.session_id
         join studio_groups g on g.id = s.group_id
        where b.participant_id = $1 order by s.held_on`, [k.participant_id]);
    console.log(`  записей на занятия: ${b.length}`);
    for (const x of b) console.log(`    ${x.day} · ${x.title}${x.status === 'booked' ? '' : ` · ${x.status}`}`);

    const { rows: a } = await c.query(
      `select s.held_on::text as day, a.status
         from attendance a join studio_sessions s on s.id = a.session_id
        where a.participant_id = $1 order by s.held_on`, [k.participant_id]);
    const был = a.filter((x) => x.status === 'present');
    console.log(`  отметок: ${a.length}, из них «был»: ${был.length}`);

    const { rows: ch } = await c.query(
      `select s.held_on::text as day, c2.amount::text,
              (c2.pass_id is not null) as on_pass, (c2.payment_id is not null) as paid
         from charges c2 join studio_sessions s on s.id = c2.session_id
        where c2.participant_id = $1 order by s.held_on`, [k.participant_id]);
    console.log(`  начислений: ${ch.length}`);
    for (const x of ch) {
      console.log(`    ${x.day} · ${x.amount} ₪ · ${x.on_pass ? 'по абонементу' : x.paid ? 'оплачено' : 'долг'}`);
    }
  }
} finally {
  await c.end();
}
