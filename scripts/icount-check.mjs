// Проверяет, что токен iCount живой и что тип документа выбран верно.
// Ничего не выписывает: боевая проверка — тот самый платёж на пять шекелей.
// Запуск: npm run icount
const BASE = 'https://api.icount.co.il/api/v3.php';

const token = (process.env.ICOUNT_TOKEN ?? '').trim();
const doctype = (process.env.ICOUNT_DOCTYPE ?? '').trim() || 'receipt';

if (!token) {
  console.error('нужен ICOUNT_TOKEN. Токен заводится в iCount:');
  console.error('  Настройки → אוטומציה → API Tokens');
  process.exit(1);
}

async function call(method, body = {}) {
  const res = await fetch(`${BASE}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch {
    console.error(`\n${method}: ответ не JSON, код ${res.status}`);
    console.error(text.trim().slice(0, 300) || '(пустое тело)');
    process.exit(1);
  }
  if (data.status === false) {
    console.error(`\n${method}: ${data.reason} — ${data.error_description ?? ''}`);
    if (data.reason === 'no_auth') {
      console.error('Токен не принят. Проверьте, что он от боевого счёта и не отозван.');
    }
    process.exit(1);
  }
  return data;
}

const info = await call('auth/info', { get_company_info: true });
const company = info.company_info ?? {};
console.log(`счёт    ${company.company_name ?? info.cid ?? '—'}`);
console.log(`ח.פ/ע.מ  ${company.company_id ?? '—'}`);
console.log(`от имени ${info.user ?? '—'}\n`);

const { doctypes } = await call('doc/types', { list_type: 'object' });
const list = Object.values(doctypes ?? {});
if (list.length === 0) {
  console.log('счёт не отдал список типов документов');
  process.exit(0);
}

console.log('доступные типы документов:');
for (const t of list) {
  const mine = t.doctype === doctype ? ' ← выписываем этот' : '';
  const vat = t.has_vat ? 'с НДС' : 'без НДС';
  console.log(`  ${String(t.doctype).padEnd(10)} ${vat.padEnd(8)} ${t.title ?? ''}${mine}`);
}

const chosen = list.find((t) => t.doctype === doctype);
console.log();
if (!chosen) {
  console.log(`Типа «${doctype}» у счёта нет. Выберите из списка выше и положите`);
  console.log('его в ICOUNT_DOCTYPE, иначе iCount ответит bad_doctype.');
  process.exit(1);
}
if (!chosen.has_payment) {
  console.log(`Тип «${doctype}» не принимает оплату, а мы её передаём. Для осек патур`);
  console.log('нужна квитанция: receipt.');
  process.exit(1);
}
console.log(`Готово. Квитанции пойдут как «${chosen.title ?? doctype}».`);
