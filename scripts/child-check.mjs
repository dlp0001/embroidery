// Что известно про одного ребёнка: посещения, начисления и состояние
// журнала того занятия, где он был. Только чтение.
//   npm run child -- Агния
import pg from 'pg';

const url = process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL не задан'); process.exit(1); }
const name = process.argv.slice(2).find((a) => !a.startsWith('-'));
if (!name) { console.error('нужно имя: npm run child -- Агния'); process.exit(1); }

let local = false;
try {
  const h = new URL(url).hostname;
  local = h === 'localhost' || h === '127.0.0.1';
} catch {}

const c = new pg.Client(local ? { connectionString: url } : { connectionString: url, ssl: { rejectUnauthorized: true } });
await c.connect();
try {
  const { rows } = await c.query(
    `select ch.name, s.held_on::text as day, g.title, a.status,
            (select count(*)::int from attendance a2 where a2.session_id = s.id) as marked,
            (select count(*)::int from charges c2 where c2.session_id = s.id) as charges,
            exists (select 1 from charges c3
                     where c3.session_id = s.id and c3.participant_id = p.id) as his_charge,
            exists (select 1 from guardians gg where gg.child_id = ch.id) as has_parent
       from children ch
       join participants p on p.child_id = ch.id
       left join attendance a on a.participant_id = p.id
       left join studio_sessions s on s.id = a.session_id
       left join studio_groups g on g.id = s.group_id
      where ch.name ilike $1
      order by s.held_on`,
    [`${name}%`],
  );
  if (rows.length === 0) { console.log('никого не нашлось'); process.exit(0); }
  for (const r of rows) {
    console.log(`${r.name}${r.has_parent ? '' : ' · родителя нет'}`);
    if (!r.day) { console.log('  посещений нет'); continue; }
    console.log(`  ${r.day} · ${r.title} · отметка «${r.status}»`);
    console.log(`  в журнале этого занятия: отметок ${r.marked}, начислений ${r.charges}`);
    console.log(`  начисление на неё: ${r.his_charge ? 'есть' : 'нет'}`);
  }
} finally {
  await c.end();
}
