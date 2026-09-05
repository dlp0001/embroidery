// Показывает способы оплаты, доступные терминалу: включён ли Bit, Apple Pay и прочее.
// Запуск: npm run payplus:methods
const mode = process.env.PAYPLUS_ENV === 'prod' ? 'prod' : 'test';
const base = mode === 'prod'
  ? 'https://restapi.payplus.co.il/api/v1.0'
  : 'https://restapidev.payplus.co.il/api/v1.0';

const apiKey = (process.env.PAYPLUS_API_KEY ?? '').trim();
const secretKey = (process.env.PAYPLUS_SECRET_KEY ?? '').trim();
if (!apiKey || !secretKey) {
  console.error('нужны PAYPLUS_API_KEY и PAYPLUS_SECRET_KEY');
  process.exit(1);
}

// Пробуем оба написания пути: у PayPlus регистр в документации плавает.
const paths = ['/PaymentPages/ChargeMethods', '/PaymentPages/chargeMethods'];
let res, text, used;
for (const path of paths) {
  used = path;
  res = await fetch(`${base}${path}`, {
    headers: { 'api-key': apiKey, 'secret-key': secretKey },
  });
  text = await res.text();
  if (res.ok) break;
}

let data;
try { data = JSON.parse(text); } catch {
  console.error(`\nответ не JSON от ${new URL(base).host}${used}`);
  console.error(`  код: ${res.status} ${res.statusText}`);
  console.error(`  тело: ${text.trim() ? text.trim().slice(0, 300) : '(пустое)'}`);
  console.error('  заголовки ответа:');
  for (const [k, v] of res.headers) console.error(`    ${k}: ${v}`);
  console.error(`\n  ключ начинается на ${apiKey.slice(0, 6)}…, длина ${apiKey.length}`);
  console.error(`  секрет начинается на ${secretKey.slice(0, 6)}…, длина ${secretKey.length}`);
  console.error('\nПустой 403 или not-authorize на документированном пути обычно значит,');
  console.error('что терминалу не открыт доступ к REST API. Это включает поддержка PayPlus.');
  process.exit(1);
}
if (!res.ok) {
  console.error(`PayPlus ответил ${res.status}:`, JSON.stringify(data).slice(0, 300));
  process.exit(1);
}

const pick = (o) => Array.isArray(o) ? o
  : Array.isArray(o?.data) ? o.data
  : Array.isArray(o?.data?.charge_methods) ? o.data.charge_methods
  : Array.isArray(o?.charge_methods) ? o.charge_methods
  : null;

const list = pick(data);
console.log(`среда ${mode}\n`);
if (!list) {
  console.log('не разобрал ответ, показываю как есть:');
  console.log(JSON.stringify(data, null, 2).slice(0, 1500));
} else {
  for (const m of list) {
    const on = m.valid === true || m.enabled === true || m.active === true;
    console.log(`  ${on ? 'включён ' : 'выключен'}  ${m.name ?? JSON.stringify(m)}${m.default ? '  (по умолчанию)' : ''}`);
  }
  const bit = list.find((m) => String(m.name ?? '').toLowerCase().includes('bit'));
  console.log();
  if (!bit) console.log('Bit в списке не появился — значит услуга не подключена к терминалу.');
  else if (bit.valid || bit.enabled || bit.active) {
    console.log('Bit включён. Он появится на платёжной странице сам.');
    console.log(`Чтобы он был выбран заранее: PAYPLUS_CHARGE_DEFAULT=${bit.name}`);
  } else {
    console.log('Bit есть в списке, но выключен — включается на стороне PayPlus.');
  }
}
