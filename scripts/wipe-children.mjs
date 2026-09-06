// Убирает всех детей из базы: сами записи, связи с родителями, участников
// и отмеченные дни. Ребёнка, у которого уже есть посещения, начисления или
// записи на занятия, не трогает: журналы и деньги переписывать нельзя, для
// таких в кабинете есть «Убрать», оно прячет, а не стирает.
//
//   npm run children            — показать, кто уйдёт
//   npm run children -- --yes   — удалить
//   npm run children:prod       — то же самое для боевой базы
import pg from 'pg';

const url = process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL не задан'); process.exit(1); }

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
    `select ch.id, ch.name, ch.archived_at is not null as archived,
            coalesce(u.name, u.email) as parent,
            (select count(*) from attendance a
               join participants p on p.id = a.participant_id where p.child_id = ch.id)
          + (select count(*) from charges c2
               join participants p on p.id = c2.participant_id where p.child_id = ch.id)
          + (select count(*) from bookings b
               join participants p on p.id = b.participant_id where p.child_id = ch.id) as used
       from children ch
       left join guardians g on g.child_id = ch.id
       left join users u on u.id = g.user_id
      order by ch.name`);

  const free = rows.filter((r) => Number(r.used) === 0);
  const kept = rows.filter((r) => Number(r.used) > 0);

  console.log(`Детей в базе: ${rows.length}`);
  for (const r of free) {
    console.log(`  удалить · ${r.name}${r.parent ? ` · ${r.parent}` : ''}${r.archived ? ' · скрыт' : ''}`);
  }
  for (const r of kept) {
    console.log(`  оставить · ${r.name}${r.parent ? ` · ${r.parent}` : ''} · следов: ${r.used}`);
  }

  if (free.length === 0) {
    console.log('\nУдалять нечего.');
    process.exit(0);
  }
  if (!apply) {
    console.log(`\nЭто был просмотр, база не изменилась. Чтобы удалить: npm run ${
      local ? 'children' : 'children:prod'} -- --yes`);
    process.exit(0);
  }

  const ids = free.map((r) => r.id);
  await c.query('begin');
  await c.query(
    `delete from preferred_days pd using participants p
      where pd.participant_id = p.id and p.child_id = any($1::uuid[])`, [ids]);
  await c.query(
    `delete from studio_members sm using participants p
      where sm.participant_id = p.id and p.child_id = any($1::uuid[])`, [ids]);
  await c.query('delete from participants where child_id = any($1::uuid[])', [ids]);
  await c.query('delete from guardians where child_id = any($1::uuid[])', [ids]);
  await c.query('delete from children where id = any($1::uuid[])', [ids]);
  await c.query('commit');

  console.log(`\nУдалено детей: ${free.length}.${kept.length ? ` Оставлено со следами: ${kept.length}.` : ''}`);
} catch (e) {
  await c.query('rollback').catch(() => {});
  console.error(e.message);
  process.exit(1);
} finally {
  await c.end();
}
