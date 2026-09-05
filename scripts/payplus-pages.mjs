// Показывает платёжные страницы терминала: нужен их uid для PAYPLUS_PAGE_UID.
// Запуск: npm run payplus:pages
const env = process.env.PAYPLUS_ENV === 'prod' ? 'prod' : 'test';
const base = env === 'prod'
  ? 'https://restapi.payplus.co.il/api/v1.0'
  : 'https://restapidev.payplus.co.il/api/v1.0';

const apiKey = process.env.PAYPLUS_API_KEY;
const secretKey = process.env.PAYPLUS_SECRET_KEY;
const terminal = process.env.PAYPLUS_TERMINAL_UID;

if (!apiKey || !secretKey) {
  console.error('нужны PAYPLUS_API_KEY и PAYPLUS_SECRET_KEY');
  console.error('положите их в .env.production.local или передайте в команду');
  process.exit(1);
}

const url = new URL(`${base}/PaymentPages/list/`);
if (terminal) url.searchParams.set('terminal_uid', terminal);

const res = await fetch(url, {
  headers: { 'api-key': apiKey, 'secret-key': secretKey },
});
const text = await res.text();

let data;
try { data = JSON.parse(text); } catch {
  console.error(`ответ не JSON (${res.status}):`, text.slice(0, 300));
  process.exit(1);
}

if (!res.ok) {
  console.error(`PayPlus ответил ${res.status}:`, JSON.stringify(data).slice(0, 400));
  if (!terminal) console.error('\nвозможно, не хватает PAYPLUS_TERMINAL_UID — он есть в кабинете');
  process.exit(1);
}

const pages = data?.data ?? data?.results ?? data;
const list = Array.isArray(pages) ? pages : (Array.isArray(pages?.payment_pages) ? pages.payment_pages : []);

if (list.length === 0) {
  console.log(`среда ${env}: страниц не вернулось. Полный ответ:`);
  console.log(JSON.stringify(data, null, 2).slice(0, 1200));
} else {
  console.log(`среда ${env}, страниц: ${list.length}\n`);
  for (const p of list) {
    console.log(`  ${p.name ?? 'без имени'}`);
    console.log(`  PAYPLUS_PAGE_UID=${p.uid}`);
    if (p.terminal_uid) console.log(`  терминал: ${p.terminal_uid}`);
    console.log();
  }
}
