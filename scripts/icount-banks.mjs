// Банковские счета компании в iCount и их номера. Номер нужен затем,
// что банковский перевод iCount принимает только с указанием счёта,
// на который деньги пришли. Найденный номер кладётся в ICOUNT_BANK_ACCOUNT.
//
// Только чтение: ничего не выписывает и не меняет.
//   npm run icount:banks
const token = (process.env.ICOUNT_TOKEN ?? '').trim();
if (!token) { console.error('ICOUNT_TOKEN не задан'); process.exit(1); }

const res = await fetch('https://api.icount.co.il/api/v3.php/bank/accounts', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  body: JSON.stringify({}),
});
const data = await res.json();
if (data.status === false) {
  console.error('отказ:', data.reason, data.error_description);
  process.exit(1);
}

// iCount отдаёт счета то массивом, то объектом с ключами-номерами.
const raw = data.bank_accounts ?? data.accounts ?? data;
const list = Array.isArray(raw) ? raw : Object.entries(raw ?? {});

if (list.length === 0) {
  console.log('Счетов не нашлось. Ответ целиком:');
  console.log(JSON.stringify(data, null, 2));
  process.exit(0);
}

for (const item of list) {
  const [key, a] = Array.isArray(item) ? item : [null, item];
  if (a === null || typeof a !== 'object') { console.log(`${key}: ${a}`); continue; }
  const id = a.account_id ?? a.id ?? key;
  const имя = a.name ?? a.account_name ?? a.nickname ?? '';
  const банк = a.bank_name ?? a.bank ?? '';
  const счёт = a.account_number ?? a.account ?? '';
  console.log(`id ${id} · ${[имя, банк, счёт].filter(Boolean).join(' · ') || JSON.stringify(a)}`);
}

console.log('\nНужный id впишите в ICOUNT_BANK_ACCOUNT на Vercel.');
