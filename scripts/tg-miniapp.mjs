// Доступ к мини-приложению со статистикой: команда /stats в меню у Вари
// и админов. У родителей меню прежнее, и про мини-приложение они даже не
// узнают: список команд телеграм хранит отдельно для каждого чата.
//
//   npm run tg:miniapp:prod             показать, что у кого стоит
//   npm run tg:miniapp:prod -- --set    добавить /stats в меню
//   npm run tg:miniapp:prod -- --set --only Дима    одному
//   npm run tg:miniapp:prod -- --set --button       ещё и кнопка у поля ввода
//   npm run tg:miniapp:prod -- --off    убрать и то, и другое
import pg from 'pg';

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) { console.error('TELEGRAM_BOT_TOKEN не задан'); process.exit(1); }
const url = process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL не задан'); process.exit(1); }

const args = process.argv.slice(2);
const set = args.includes('--set');
// Кому именно: часть имени. Без него кнопка ставится всем, кому положено.
const onlyAt = args.indexOf('--only');
const only = onlyAt === -1 ? null : (args[onlyAt + 1] ?? '').toLowerCase();
// Кнопка у поля ввода — отдельно: она занимает место словом «Статистика»
// и прячет под собой меню команд, поэтому по умолчанию её не ставим.
const button = args.includes('--button');
const off = args.includes('--off');
const origin = (args.find((a) => a.startsWith('http')) ?? process.env.SITE_URL
  ?? 'https://www.re-create.art').replace(/\/+$/, '');

const api = async (method, body) => {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(`${method}: ${data.description ?? res.status}`);
  return data.result;
};

const local = new URL(url).hostname === 'localhost';
const c = new pg.Client(local ? { connectionString: url }
  : { connectionString: url, ssl: { rejectUnauthorized: true } });
await c.connect();

// Кому кнопка: преподаватель и админы. Роли те же, что проверяет роут
// мини-приложения, иначе кнопка вела бы в «нет доступа».
const { rows } = await c.query(
  `select u.name, u.tg_chat_id::text as chat_id,
          bool_or(r.role in ('admin', 'superadmin')) as admin
     from users u join user_roles r on r.user_id = u.id
    where r.role in ('teacher', 'admin', 'superadmin')
      and u.tg_chat_id is not null
    group by u.id, u.name, u.tg_chat_id
    order by u.name`,
);
await c.end();

const people = only
  ? rows.filter((r) => (r.name ?? '').toLowerCase().includes(only))
  : rows;
if (people.length === 0) {
  console.error(only ? `Никто из админов не похож на «${only}».`
    : 'Некому ставить: ни у кого из админов нет бота.');
  process.exit(1);
}

const webApp = `${origin}/tg/stats`;
console.log(`Бот: @${(await api('getMe')).username}`);
console.log(`Адрес мини-приложения: ${webApp}\n`);

// Список для чата заменяет общий целиком, поэтому к общим командам
// дописываем /stats, а не шлём её одну.
const COMMON = [
  { command: 'week', description: 'Расписание и запись' },
  { command: 'pay', description: 'Оплата и задолженность' },
  { command: 'help', description: 'Что умеет бот' },
];
const STATS = { command: 'stats', description: 'Статистика студии' };
// Выплаты Isracard — деньги кассы, их видят только админы.
const ISRACARD = { command: 'isracard', description: 'Выплаты Isracard' };

for (const r of people) {
  const scope = { type: 'chat', chat_id: Number(r.chat_id) };
  if (set) {
    const commands = [COMMON[0], COMMON[1], STATS,
      ...(r.admin ? [ISRACARD] : []), COMMON[2]];
    await api('setMyCommands', { scope, commands });
  } else if (off) {
    // Удаляем список чата: телеграм вернётся к общему, где /stats нет.
    await api('deleteMyCommands', { scope });
  }
  if (set && button) {
    await api('setChatMenuButton', {
      chat_id: Number(r.chat_id),
      menu_button: { type: 'web_app', text: 'Статистика', web_app: { url: webApp } },
    });
  }
  if (off || (set && !button)) {
    await api('setChatMenuButton', { chat_id: Number(r.chat_id), menu_button: { type: 'commands' } });
  }

  const menu = await api('getMyCommands', { scope });
  const now = await api('getChatMenuButton', { chat_id: Number(r.chat_id) });
  const what = now.type === 'web_app' ? `кнопка «${now.text}»` : 'меню команд';
  console.log(`  ${r.name ?? r.chat_id}: ${what} · ${
    menu.length ? menu.map((x) => `/${x.command}`).join(' ') : 'список чата пуст, берётся общий'}`);
}

if (!set && !off) console.log('\nНичего не меняли. Поставить — флаг --set.');
