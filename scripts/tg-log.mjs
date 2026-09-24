// Что бот разослал сам: кому, когда и каким текстом. Только чтение.
//
//   npm run tg:log:prod           последние 10 рассылок
//   npm run tg:log:prod -- 30     последние 30
//
// Ответы на сообщения родителей сюда не попадают: это переписка, её видит
// сам человек. В журнале только то, что бот послал без спроса.
import pg from 'pg';

const url = process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL не задан'); process.exit(1); }
const local = new URL(url).hostname === 'localhost';
const c = new pg.Client(local ? { connectionString: url } : { connectionString: url, ssl: { rejectUnauthorized: true } });
await c.connect();
await c.query("set time zone 'Asia/Jerusalem'");

const limit = Number(process.argv.find((a) => /^\d+$/.test(a)) ?? 10);
const { rows } = await c.query(
  `select l.campaign, l.chat_id::text, l.sent_at::timestamp(0)::text as sent,
          coalesce(u.name, 'чат не привязан') as who, l.text
     from tg_log l left join users u on u.tg_chat_id = l.chat_id
    order by l.sent_at desc limit $1`, [limit]);

if (rows.length === 0) console.log('журнал пуст');
for (const r of rows) {
  console.log(`\n${'─'.repeat(52)}`);
  console.log(`${r.sent} · ${r.who} · ${r.campaign}`);
  console.log(r.text ? r.text.split('\n').map((l) => '  ' + l).join('\n') : '  (текст не сохранён: отправлено до 018)');
}
await c.end();
