// Кнопка «Статистика» в телеграме. Ставится точечно, в чаты Вари и
// админов: у остальных рядом с полем ввода остаётся обычное меню команд,
// и про мини-приложение они даже не узнают.
//
//   npm run tg:miniapp:prod            показать, кому стоит кнопка
//   npm run tg:miniapp:prod -- --set   поставить
//   npm run tg:miniapp:prod -- --off   вернуть меню команд
import pg from 'pg';

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) { console.error('TELEGRAM_BOT_TOKEN не задан'); process.exit(1); }
const url = process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL не задан'); process.exit(1); }

const args = process.argv.slice(2);
const set = args.includes('--set');
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
  `select distinct u.name, u.tg_chat_id::text as chat_id
     from users u join user_roles r on r.user_id = u.id
    where r.role in ('teacher', 'admin', 'superadmin')
      and u.tg_chat_id is not null
    order by u.name`,
);
await c.end();

if (rows.length === 0) { console.error('Некому ставить: ни у кого из админов нет бота.'); process.exit(1); }

const webApp = `${origin}/tg/stats`;
console.log(`Бот: @${(await api('getMe')).username}`);
console.log(`Адрес мини-приложения: ${webApp}\n`);

for (const r of rows) {
  if (set || off) {
    await api('setChatMenuButton', {
      chat_id: Number(r.chat_id),
      menu_button: off
        ? { type: 'commands' }
        : { type: 'web_app', text: 'Статистика', web_app: { url: webApp } },
    });
  }
  const now = await api('getChatMenuButton', { chat_id: Number(r.chat_id) });
  const what = now.type === 'web_app' ? `«${now.text}» → ${now.web_app?.url}` : now.type;
  console.log(`  ${r.name ?? r.chat_id}: ${what}`);
}

if (!set && !off) console.log('\nНичего не меняли. Поставить — флаг --set.');
