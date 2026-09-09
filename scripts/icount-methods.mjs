// Какие способы оплаты включены в iCount и как они называются в API.
// Только чтение: ничего не выписывает и не меняет.
//   npm run icount:methods
const token = (process.env.ICOUNT_TOKEN ?? '').trim();
if (!token) { console.error('ICOUNT_TOKEN не задан'); process.exit(1); }

const res = await fetch('https://api.icount.co.il/api/v3.php/payment_method/get_list', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  body: JSON.stringify({ list_type: 'array' }),
});
const data = await res.json();
if (data.status === false) {
  console.error('отказ:', data.reason, data.error_description);
  process.exit(1);
}

const list = Array.isArray(data.payment_methods)
  ? data.payment_methods
  : Object.values(data.payment_methods ?? {});

for (const m of list) {
  console.log(`${m.enabled ? '✓' : '·'} код «${m.code}» · id ${m.id} · ${m.name_en || m.name}`);
  // Ключи card_brands — это и есть значения для card_brand в doc/create.
  for (const [key, b] of Object.entries(m.card_brands ?? {})) {
    console.log(`    card_brand «${key}» → ${b.name_en || b.name}`);
  }
}
