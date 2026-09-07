// Удаляет учётку вместе с её детьми: связи, участников, дни, входы и коды.
// Если за человеком уже числятся посещения, начисления или платежи, скрипт
// отказывается: бухгалтерию и журналы стирать нельзя, такого надо прятать.
// Ребёнка, у которого есть второй родитель, оставляем: он не только этой семьи.
//
//   npm run user -- кто@то            — показать, что уйдёт
//   npm run user -- кто@то --yes      — удалить
//   npm run user:prod -- кто@то       — то же для боевой базы
import pg from 'pg';

const url = process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL не задан'); process.exit(1); }

const email = (process.argv.slice(2).find((a) => a.includes('@')) ?? '').trim().toLowerCase();
if (!email) {
  console.error('нужна почта: npm run user -- кто@то [--yes]');
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

  const { rows: users } = await c.query(
    `select u.id, u.name, coalesce(string_agg(r.role, ', '), '—') as roles
       from users u left join user_roles r on r.user_id = u.id
      where u.email = $1 group by u.id, u.name`, [email]);
  if (users.length === 0) {
    console.error(`Такой почты в базе нет: ${email}`);
    process.exit(1);
  }
  const user = users[0];

  const { rows: kids } = await c.query(
    `select ch.id, ch.name,
            (select count(*) from guardians g2 where g2.child_id = ch.id) as guardians
       from children ch join guardians g on g.child_id = ch.id
      where g.user_id = $1 order by ch.name`, [user.id]);

  // Всё, что нельзя стереть, не переписав историю студии. Брошенная касса
  // историей не считается: денег по ней не прошло, это оборванная попытка.
  const { rows: [used] } = await c.query(
    `select (select count(*) from charges where owner_id = $1) as charges,
            (select count(*) from payments where user_id = $1 and status = 'paid') as paid,
            (select count(*) from payments where user_id = $1 and status <> 'paid') as unpaid,
            (select count(*) from passes where owner_id = $1) as passes,
            (select count(*) from attendance a join participants p on p.id = a.participant_id
              where p.user_id = $1 or p.child_id in (select child_id from guardians where user_id = $1)
            ) as attendance`, [user.id]);

  console.log(`${email} · ${user.name ?? 'без имени'} · ${user.roles}`);
  console.log(`  дети: ${kids.length === 0 ? 'нет' : kids.map((k) => k.name).join(', ')}`);
  const shared = kids.filter((k) => Number(k.guardians) > 1);
  for (const k of shared) console.log(`  ${k.name} останется: у него есть второй родитель`);
  console.log(`  посещений ${used.attendance} · начислений ${used.charges} · оплачено ${used.paid} · абонементов ${used.passes}`);
  if (Number(used.unpaid) > 0) {
    console.log(`  брошенных касс: ${used.unpaid} — уйдут вместе с учёткой, денег по ним не прошло`);
  }

  const total = Number(used.attendance) + Number(used.charges) + Number(used.paid) + Number(used.passes);
  if (total > 0) {
    console.error('\nЗа этой учёткой есть история. Удалять нельзя: пропадут журналы и деньги.');
    process.exit(1);
  }
  if (!apply) {
    console.log(`\nЭто был просмотр, база не изменилась. Чтобы удалить: npm run ${
      local ? 'user' : 'user:prod'} -- ${email} --yes`);
    process.exit(0);
  }

  const mine = kids.filter((k) => Number(k.guardians) === 1).map((k) => k.id);
  await c.query('begin');
  if (mine.length > 0) {
    await c.query(
      `delete from preferred_days pd using participants p
        where pd.participant_id = p.id and p.child_id = any($1::uuid[])`, [mine]);
    await c.query(
      `delete from studio_members sm using participants p
        where sm.participant_id = p.id and p.child_id = any($1::uuid[])`, [mine]);
    await c.query('delete from participants where child_id = any($1::uuid[])', [mine]);
  }
  await c.query('delete from guardians where user_id = $1', [user.id]);
  if (mine.length > 0) await c.query('delete from children where id = any($1::uuid[])', [mine]);

  await c.query(
    `delete from preferred_days pd using participants p
      where pd.participant_id = p.id and p.user_id = $1`, [user.id]);
  await c.query(
    `delete from studio_members sm using participants p
      where sm.participant_id = p.id and p.user_id = $1`, [user.id]);
  await c.query('delete from participants where user_id = $1', [user.id]);
  await c.query(`delete from payments where user_id = $1 and status <> 'paid'`, [user.id]);
  await c.query('delete from sessions where user_id = $1', [user.id]);
  await c.query('delete from login_codes where email = $1', [email]);
  await c.query('delete from user_roles where user_id = $1', [user.id]);
  await c.query('delete from users where id = $1', [user.id]);
  await c.query('commit');

  console.log(`\nУдалено: учётка ${email}${mine.length ? ` и детей: ${mine.length}` : ''}.`);
} catch (e) {
  await c.query('rollback').catch(() => {});
  console.error(e.message);
  process.exit(1);
} finally {
  await c.end();
}
