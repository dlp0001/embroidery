// Время печатается рядом с названием везде: в сводке, в календаре, в
// журнале и в неделе у родителя. В названии оно лишнее.
import pg from 'pg';
const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: true } });
await c.connect();
const { rows } = await c.query(
  `update studio_groups set title = 'Четверг'
    where weekday = 4 and kind = 'lesson' and title like 'Четверг ·%'
    returning title, starts_at::text as at`);
for (const r of rows) console.log(`${r.at} → «${r.title}»`);
await c.end();
