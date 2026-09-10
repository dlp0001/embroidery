// Создаёт занятия по расписанию действующих групп до указанной даты.
// Обычно их досыпает само приложение на шесть недель вперёд; этим
// скриптом можно раскатать дальше — например, до конца года.
//
//   npm run fill -- 2026-12-31         — показать, сколько добавится
//   npm run fill -- 2026-12-31 --yes   — создать
//   npm run fill:prod -- 2026-12-31    — то же для боевой базы
import pg from 'pg';

const url = process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL не задан'); process.exit(1); }

const until = process.argv.slice(2).find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a));
if (!until) { console.error('нужна дата: npm run fill -- 2026-12-31 [--yes]'); process.exit(1); }

const host = new URL(url).hostname;
const local = host === 'localhost' || host === '127.0.0.1' || host === '::1';
if (!local && !process.argv.includes('--allow-remote')) {
  console.error(`База не локальная (${host}). Без флага --allow-remote скрипт её не тронет.`);
  process.exit(1);
}

const apply = process.argv.includes('--yes');
const c = new pg.Client(local ? { connectionString: url } : { connectionString: url, ssl: { rejectUnauthorized: true } });
await c.connect();
try {
  if (!local) console.log(`База не локальная: ${host}\n`);

  // Что появится: по каждой действующей группе — сколько дней её недели
  // попадает в промежуток и сколько из них ещё не заведено.
  const { rows: plan } = await c.query(
    `select g.title,
            case g.weekday when 1 then 'пн' when 2 then 'вт' when 3 then 'ср'
                           when 4 then 'чт' when 5 then 'пт' when 6 then 'сб'
                           else 'вс' end as day,
            g.starts_at::text,
            count(*)::int as new_ones,
            min(d)::date::text as first_day, max(d)::date::text as last_day
       from studio_groups g
       cross join generate_series(current_date, $1::date, interval '1 day') d
      where g.active
        and extract(isodow from d) = g.weekday
        and not exists (select 1 from studio_sessions s
                         where s.group_id = g.id and s.held_on = d::date)
      group by g.id, g.title, g.weekday, g.starts_at
      order by g.weekday, g.starts_at`,
    [until],
  );

  const total = plan.reduce((s, r) => s + r.new_ones, 0);
  console.log(`Занятий добавится до ${until}: ${total}`);
  for (const r of plan) {
    console.log(`  ${r.day} ${r.starts_at.slice(0, 5)} · ${r.title}: ${r.new_ones} (с ${r.first_day} по ${r.last_day})`);
  }
  if (total === 0) { console.log('  всё уже создано'); process.exit(0); }

  if (!apply) {
    console.log(`\nЭто был просмотр. Чтобы создать: npm run ${
      local ? 'fill' : 'fill:prod'} -- ${until} --yes`);
    process.exit(0);
  }

  const { rowCount } = await c.query(
    `insert into studio_sessions (group_id, held_on)
     select g.id, d::date
       from studio_groups g
       cross join generate_series(current_date, $1::date, interval '1 day') d
      where g.active and extract(isodow from d) = g.weekday
     on conflict (group_id, held_on) do nothing`,
    [until],
  );
  console.log(`\nСоздано занятий: ${rowCount}.`);
} finally {
  await c.end();
}
