// Что лежит в базе: учётки с ролями и число строк по таблицам.
// Только чтение. Нужен, чтобы посмотреть на базу перед чисткой.
//   npm run inventory        (локальная)
//   npm run inventory:prod   (боевая)
import pg from 'pg';

const url = process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL не задан'); process.exit(1); }

let local = false;
try {
  const h = new URL(url).hostname;
  local = h === 'localhost' || h === '127.0.0.1';
  // Регион базы — не секрет, а от него зависит, где держать функции.
  const region = h.split('.').slice(-4, -3)[0];
  console.log(`База: ${local ? 'локальная' : `${region ?? 'регион не разобрать'}, пул ${h.includes('-pooler') ? 'включён' : 'ВЫКЛЮЧЕН'}`}\n`);
} catch {}

const TABLES = [
  'users', 'user_roles', 'children', 'guardians', 'participants', 'preferred_days',
  'studio_groups', 'studio_members', 'studio_sessions', 'bookings', 'attendance',
  'charges', 'passes', 'payments', 'money_events',
  'courses', 'lessons', 'enrollments', 'consents', 'sessions', 'login_codes', 'settings',
];

const c = new pg.Client(local ? { connectionString: url } : { connectionString: url, ssl: { rejectUnauthorized: true } });
await c.connect();
try {
  const { rows: users } = await c.query(
    `select u.email, u.name, coalesce(string_agg(r.role, ', ' order by r.role), '—') as roles,
            (select count(*)::int from guardians g where g.user_id = u.id) as children
       from users u left join user_roles r on r.user_id = u.id
      group by u.id, u.email, u.name order by u.email`);

  console.log(`Учётки (${users.length}):`);
  for (const u of users) {
    console.log(`  ${u.email} · ${u.name ?? 'без имени'} · ${u.roles}${u.children ? ` · детей: ${u.children}` : ''}`);
  }

  console.log('\nСтроки в таблицах:');
  for (const t of TABLES) {
    const { rows } = await c.query(`select count(*)::int as n from ${t}`);
    if (rows[0].n > 0) console.log(`  ${t}: ${rows[0].n}`);
  }
} finally {
  await c.end();
}
