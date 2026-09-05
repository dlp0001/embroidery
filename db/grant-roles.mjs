// Выдача ролей. Заводит человека, если его ещё нет, и добавляет роли.
// Запуск: DATABASE_URL='<строка>' node db/grant-roles.mjs почта роль[,роль] [Имя]
import pg from 'pg';

function pgConfig(connectionString) {
  let local = false;
  try {
    const host = new URL(connectionString).hostname;
    local = host === 'localhost' || host === '127.0.0.1';
  } catch {}
  return local ? { connectionString } : { connectionString, ssl: { rejectUnauthorized: true } };
}

const [email, rolesArg, name] = process.argv.slice(2);
const ROLES = ['parent', 'student', 'teacher', 'admin', 'superadmin'];

if (!email || !rolesArg) {
  console.error('нужно: DATABASE_URL=… node db/grant-roles.mjs почта роль[,роль] [Имя]');
  console.error('роли:', ROLES.join(', '));
  process.exit(1);
}
const roles = rolesArg.split(',').map((r) => r.trim()).filter(Boolean);
const bad = roles.filter((r) => !ROLES.includes(r));
if (bad.length) { console.error('неизвестные роли:', bad.join(', ')); process.exit(1); }

const c = new pg.Client(pgConfig(process.env.DATABASE_URL));
await c.connect();
try {
  await c.query('begin');
  const { rows } = await c.query(
    `insert into users (email, name) values ($1, $2)
     on conflict (email) do update set name = coalesce(users.name, excluded.name)
     returning id, name`,
    [email.toLowerCase(), name ?? null],
  );
  const user = rows[0];
  for (const role of roles) {
    await c.query('insert into user_roles (user_id, role) values ($1, $2) on conflict do nothing', [user.id, role]);
  }
  // Взрослый тоже может ходить на занятия, поэтому заводим участника.
  await c.query('insert into participants (user_id) values ($1) on conflict do nothing', [user.id]);
  await c.query('commit');

  const all = (await c.query('select role from user_roles where user_id = $1 order by role', [user.id])).rows.map((r) => r.role);
  console.log(`${email} → ${all.join(', ')}`);
} catch (err) {
  await c.query('rollback');
  console.error('не вышло:', err.message);
  process.exitCode = 1;
} finally {
  await c.end();
}
