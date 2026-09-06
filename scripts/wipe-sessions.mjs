// Убирает занятия по дату включительно. Занятие, по которому уже есть
// отметки или начисления, не трогает: у charges стоит каскад, и удаление
// стёрло бы деньги вместе с расписанием.
//
//   npm run sessions -- 2026-08-25            — показать, что уйдёт
//   npm run sessions -- 2026-08-25 --yes      — удалить
//   npm run sessions:prod -- 2026-08-25       — то же для боевой базы
import pg from 'pg';

const url = process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL не задан'); process.exit(1); }

const until = process.argv.slice(2).find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a));
if (!until) {
  console.error('нужна дата: npm run sessions -- 2026-08-25 [--yes]');
  process.exit(1);
}

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

  const { rows } = await c.query(
    `select s.id, s.held_on::text, g.title,
            (select count(*) from attendance a where a.session_id = s.id)
          + (select count(*) from charges ch where ch.session_id = s.id) as used
       from studio_sessions s
       join studio_groups g on g.id = s.group_id
      where s.held_on <= $1::date
      order by s.held_on`,
    [until],
  );

  const free = rows.filter((r) => Number(r.used) === 0);
  const kept = rows.filter((r) => Number(r.used) > 0);

  console.log(`Занятий по ${until} включительно: ${rows.length}`);
  if (free.length > 0) {
    console.log(`  удалить: ${free.length} (с ${free[0].held_on} по ${free[free.length - 1].held_on})`);
  }
  for (const r of kept) console.log(`  оставить · ${r.held_on} · ${r.title} · записей: ${r.used}`);

  if (free.length === 0) {
    console.log('\nУдалять нечего.');
    process.exit(0);
  }
  if (!apply) {
    console.log(`\nЭто был просмотр, база не изменилась. Чтобы удалить: npm run ${
      local ? 'sessions' : 'sessions:prod'} -- ${until} --yes`);
    process.exit(0);
  }

  const { rowCount } = await c.query(
    'delete from studio_sessions where id = any($1::uuid[])', [free.map((r) => r.id)]);
  console.log(`\nУдалено занятий: ${rowCount}.${kept.length ? ` Оставлено с записями: ${kept.length}.` : ''}`);
} catch (e) {
  console.error(e.message);
  process.exit(1);
} finally {
  await c.end();
}
