// Сообщения преподавателю руками, не дожидаясь расписания.
//
//   npm run tg:teacher            сводка на сегодня прямо сейчас
//   npm run tg:teacher -- next    напоминание про ближайшее занятие
//   npm run tg:teacher -- day http://localhost:4321   на другом адресе
//
// Нужен CRON_SECRET в .env.production.local — тот же, что в Vercel.

const secret = process.env.CRON_SECRET;
if (!secret) {
  console.error('CRON_SECRET не задан. Положите его в .env.production.local — тот же, что в Vercel.');
  process.exit(1);
}

const args = process.argv.slice(2);
const force = args.find((a) => a === 'day' || a === 'next') ?? 'day';
const origin = args.find((a) => a.startsWith('http')) ?? 'https://www.re-create.art';

const res = await fetch(`${origin}/api/cron/telegram-teacher?force=${force}`, {
  headers: { authorization: `Bearer ${secret}` },
});
const text = await res.text();
console.log(res.status, text);
if (!res.ok) process.exit(1);
