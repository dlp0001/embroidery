// Меняет почту, по которой человек входит. Вход по коду на почту, так что
// это и есть смена логина: старый адрес перестанет работать сразу.
//
//   npm run email -- было@почта стало@почта        (локальная база)
//   npm run email:prod -- было@почта стало@почта   (боевая)
//
// Открытые входы не слетают: сессия привязана к человеку, а не к адресу.
import pg from 'pg';

const url = process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL не задан'); process.exit(1); }

const [fromRaw, toRaw] = process.argv.slice(2);
if (!fromRaw || !toRaw) {
  console.error('нужно: npm run email -- было@почта стало@почта');
  process.exit(1);
}
const from = fromRaw.trim().toLowerCase();
const to = toRaw.trim().toLowerCase();
if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) {
  console.error(`«${to}» не похоже на адрес почты`);
  process.exit(1);
}

let local = false;
try {
  const h = new URL(url).hostname;
  local = h === 'localhost' || h === '127.0.0.1';
} catch {}

const c = new pg.Client(local ? { connectionString: url } : { connectionString: url, ssl: { rejectUnauthorized: true } });
await c.connect();
try {
  const { rows: who } = await c.query(
    'select id, name from users where email = $1', [from]);
  if (who.length === 0) {
    console.error(`Такой почты в базе нет: ${from}`);
    process.exit(1);
  }
  const { rows: busy } = await c.query('select id from users where email = $1', [to]);
  if (busy.length > 0) {
    console.error(`Адрес ${to} уже занят другой учёткой. Сначала разберитесь с ней.`);
    process.exit(1);
  }

  await c.query('update users set email = $2 where id = $1', [who[0].id, to]);
  // Коды входа выписаны на старый адрес и больше ни к чему.
  await c.query('delete from login_codes where email = $1', [from]);
  console.log(`${who[0].name ?? 'без имени'}: ${from} → ${to}`);
} finally {
  await c.end();
}
