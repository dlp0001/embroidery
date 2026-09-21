// Что стоит в расписании в дни смены: лагерь и обычные занятия рядом.
// Только читает.
import pg from 'pg';

const url = process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL не задан'); process.exit(1); }
const host = new URL(url).hostname;
const local = host === 'localhost' || host === '127.0.0.1';

const c = new pg.Client(local ? { connectionString: url } : { connectionString: url, ssl: { rejectUnauthorized: true } });
await c.connect();
await c.query("set time zone 'Asia/Jerusalem'");

const { rows } = await c.query(
  `select s.held_on::text, to_char(s.held_on, 'Dy') as dow, g.title, g.kind,
          g.starts_at::text, s.status
     from studio_sessions s join studio_groups g on g.id = s.group_id
    where s.held_on between (select min(starts_on) from studio_groups where kind <> 'lesson')
                        and (select max(ends_on) from studio_groups where kind <> 'lesson')
    order by s.held_on, g.starts_at`,
);
let day = null;
for (const r of rows) {
  if (r.held_on !== day) { day = r.held_on; console.log(`\n${r.held_on} ${r.dow}`); }
  console.log(`   ${r.starts_at.slice(0, 5)}  ${r.title}${r.kind !== 'lesson' ? ' · лагерь' : ''}${r.status === 'cancelled' ? ' · отменено' : ''}`);
}
await c.end();
