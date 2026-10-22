// Перевод названий у чеков, разобранных до того, как перевод появился.
// Картинку не трогаем: переводится текст, уже лежащий в базе.
//
//   npm run words:prod            перевести всё непереведённое
//
import pg from 'pg';

const url = process.env.DATABASE_URL;
const key = process.env.ANTHROPIC_API_KEY;
if (!url || !key) { console.error('нужны DATABASE_URL и ANTHROPIC_API_KEY'); process.exit(1); }
const local = ['localhost', '127.0.0.1'].includes(new URL(url).hostname);
const c = new pg.Client(local ? { connectionString: url } : { connectionString: url, ssl: { rejectUnauthorized: true } });
await c.connect();

const { rows: todo } = await c.query(
  `select distinct e.id from expenses e
     left join expense_items i on i.expense_id = e.id
    where (e.trade_name is not null and e.trade_name_en is null)
       or (e.supplier is not null and e.supplier_en is null)
       or (i.id is not null and i.name_ru is null)`);
console.log('чеков к переводу:', todo.length);

for (const { id } of todo) {
  const head = (await c.query(
    `select trade_name, trade_name_en, supplier, supplier_en
       from expenses where id = $1`, [id])).rows[0];
  const lines = (await c.query(
    `select id, name from expense_items where expense_id = $1 and name_ru is null
      order by line_no`, [id])).rows;
  const shop = head.trade_name && !head.trade_name_en ? head.trade_name : null;
  const firm = head.supplier && !head.supplier_en ? head.supplier : null;

  const ask = [
    'Переведи для русского читателя то, что напечатано на израильском чеке.',
    shop ? `Вывеска магазина: ${shop}` : '',
    firm ? `Название фирмы: ${firm}` : '',
    lines.length ? `Строки чека:\n${lines.map((l, i) => `${i + 1}. ${l.name}`).join('\n')}` : '',
    '',
    'Верни ТОЛЬКО JSON: {"shop": "вывеска латиницей", "firm": "фирма латиницей",',
    '"items": ["русское название", ...]}',
    'Вывеску и фирму передай латиницей буква в букву — транслитерация, а не',
    'перевод: «מיני מקס» → «Mini Max», «מאי - ארט» → «Mai Art». Улицы и города',
    'не досочиняй; «בע"מ» можно опустить.',
    'Строк в items ровно столько же и в том же порядке. Коротко и по делу.',
    'Чего не понял — null.',
  ].filter(Boolean).join('\n');

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_WORDS_MODEL || 'claude-haiku-4-5-20251001',
      max_tokens: 4000,
      messages: [{ role: 'user', content: ask }],
    }),
  });
  const data = await res.json();
  const said = (data.content ?? []).map((x) => x.text ?? '').join('').trim()
    .replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();

  let got;
  try { got = JSON.parse(said); } catch { console.log(`${id}: ответ не разобран`); continue; }
  if (shop && got.shop) {
    await c.query('update expenses set trade_name_en = $2 where id = $1', [id, got.shop]);
  }
  if (firm && got.firm) {
    await c.query('update expenses set supplier_en = $2 where id = $1', [id, got.firm]);
  }
  let n = 0;
  for (const [i, line] of lines.entries()) {
    const ru = (got.items ?? [])[i];
    if (typeof ru === 'string' && ru.trim()) {
      await c.query('update expense_items set name_ru = $2 where id = $1', [line.id, ru.trim()]);
      n++;
    }
  }
  console.log(`${id}: вывеска ${got.shop ?? '—'}, фирма ${got.firm ?? '—'},`
    + ` строк переведено ${n} из ${lines.length}`);
}
await c.end();
