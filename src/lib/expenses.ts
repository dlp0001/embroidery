import { one, query } from './db';
import { addSupplier, createExpense, suppliers } from './icount';
import type { Item, Scanned } from './vision';

/**
 * Расходы студии: снимок чека, разобранные поля и своя структура затрат.
 *
 * Группы наши, потому что вопрос «сколько ушло на материалы для лагеря»
 * задаёт студия, а не бухгалтерия: у iCount видов расхода три, и заведены
 * они под отчётность. Каждая наша группа знает, во что превращается там.
 */

export type Kind = {
  id: string;
  title: string;
  icount_type: number;
  /** Постоянное имя: на нём говорит модель, разбирая строки чека. */
  slug: string | null;
};

export async function kinds(): Promise<Kind[]> {
  return query<Kind>(
    `select id, title, icount_type, slug from expense_kinds
      where active order by sort, title`,
  );
}

export type Expense = {
  id: string;
  supplier: string | null;
  trade_name: string | null;
  supplier_vat: string | null;
  doc_type: string | null;
  doc_number: string | null;
  spent_on: string | null;
  amount: string | null;
  vat: string | null;
  currency: string;
  kind_id: string | null;
  kind_title: string | null;
  icount_type: number | null;
  status: string;
  icount_id: string | null;
  chat_id: string | null;
  message_id: string | null;
  what: string | null;
};

const FIELDS = `e.id, e.supplier, e.trade_name, e.supplier_vat, e.doc_type, e.doc_number,
                e.spent_on::text, e.amount::text, e.vat::text, e.currency,
                e.kind_id, k.title as kind_title, k.icount_type,
                e.status, e.icount_id, e.chat_id::text, e.message_id::text,
                e.raw ->> 'what' as what`;

export async function expenseById(id: string): Promise<Expense | null> {
  return one<Expense>(
    `select ${FIELDS} from expenses e
       left join expense_kinds k on k.id = e.kind_id
      where e.id = $1`,
    [id],
  );
}

/**
 * Кладёт снимок. Разбор приезжает следом, отдельным ходом: читается чек
 * полминуты, а потерять фотографию, пока модель думает, нельзя.
 */
export async function saveReceipt(input: {
  photo: Buffer;
  photoType: string;
  userId: string | null;
  chatId: number;
}): Promise<string> {
  const row = await one<{ id: string }>(
    `insert into expenses (photo, photo_type, user_id, chat_id)
     values ($1, $2, $3, $4) returning id`,
    [input.photo, input.photoType, input.userId, input.chatId],
  );
  return row!.id;
}

/** Записывает прочитанное: шапку в колонки, строки чека своей таблицей. */
export async function applyScan(
  id: string, scan: Scanned | null, error?: string | null,
): Promise<void> {
  await query(
    `update expenses set supplier = $2, supplier_vat = $3, doc_type = $4,
            doc_number = $5, spent_on = $6::date, amount = $7, vat = $8,
            currency = coalesce($9, currency), raw = $10::jsonb, trade_name = $11
      where id = $1`,
    [
      id, scan?.supplier ?? null, scan?.supplier_vat ?? null, scan?.doc_type ?? null,
      scan?.doc_number ?? null, scan?.spent_on ?? null, scan?.amount ?? null,
      scan?.vat ?? null, scan?.currency ?? null,
      JSON.stringify({ ...(scan ?? {}), ...(error ? { error } : {}) }),
      scan?.trade_name ?? null,
    ],
  );
  if (!scan?.items?.length) return;

  // Перечитали — значит, прежние строки неверны: кладём заново.
  await query('delete from expense_items where expense_id = $1', [id]);
  const params: unknown[] = [id];
  const rows: string[] = [];
  scan.items.forEach((it, i) => {
    const at = params.length;
    params.push(i + 1, it.sku, it.name, it.qty, it.price, it.sum, it.kind);
    rows.push(`($1, $${at + 1}, $${at + 2}, $${at + 3}, $${at + 4}, $${at + 5}, $${at + 6}, $${at + 7})`);
  });
  await query(
    `insert into expense_items (expense_id, line_no, sku, name, qty, price, sum, kind_guess)
     values ${rows.join(', ')}`,
    params,
  );
}

/** Строки чека по порядку печати. */
export async function itemsOf(id: string): Promise<Item[]> {
  const rows = await query<{
    sku: string | null; name: string; qty: string | null;
    price: string | null; sum: string | null; kind_guess: string | null;
  }>(
    `select sku, name, qty::text, price::text, sum::text, kind_guess
       from expense_items where expense_id = $1 order by line_no`,
    [id],
  );
  return rows.map((r) => ({
    sku: r.sku,
    name: r.name,
    qty: r.qty === null ? null : Number(r.qty),
    price: r.price === null ? null : Number(r.price),
    sum: r.sum === null ? null : Number(r.sum),
    kind: (r.kind_guess ?? 'other') as Item['kind'],
  }));
}

export type Split = { kind: string; sum: number; n: number };

/**
 * Прикидка по группам: сколько из похода в магазин было материалами, а
 * сколько едой. Считается по строкам, то есть по показаниям модели, —
 * поэтому рядом всегда стоит, сошлись ли строки с итогом чека.
 */
export async function splitOf(id: string): Promise<{ parts: Split[]; sum: number }> {
  const rows = await query<{ kind: string; sum: string; n: number }>(
    `select coalesce(kind_guess, 'other') as kind,
            coalesce(sum(sum), 0)::text as sum, count(*)::int as n
       from expense_items where expense_id = $1
      group by 1 order by sum(sum) desc nulls last`,
    [id],
  );
  const parts = rows.map((r) => ({ kind: r.kind, sum: Number(r.sum), n: r.n }));
  return { parts, sum: parts.reduce((s, p) => s + p.sum, 0) };
}

/** Запоминает, в каком сообщении висит карточка: её потом переписываем. */
export async function rememberCard(id: string, messageId: number): Promise<void> {
  await query('update expenses set message_id = $2 where id = $1', [id, messageId]);
}

export async function setKind(id: string, kindId: string): Promise<void> {
  await query(
    `update expenses set kind_id = $2 where id = $1 and status = 'new'`, [id, kindId]);
}

export async function dropExpenseRow(id: string): Promise<void> {
  await query(
    `update expenses set status = 'dropped' where id = $1 and status = 'new'`, [id]);
}

/**
 * Находит поставщика в бухгалтерии или заводит его.
 *
 * Сначала по ח.פ: написание названия на чеках пляшет, а номер в реестре
 * один. Потом по имени — на случай, когда номер не напечатан или не
 * прочитался.
 */
async function supplierFor(name: string, vat: string | null): Promise<string | null> {
  const list = await suppliers();
  const digits = (s: string | null | undefined) => (s ?? '').replace(/\D/g, '');
  if (vat) {
    const byVat = list.find((s) => digits(s.vat_id) && digits(s.vat_id) === digits(vat));
    if (byVat) return byVat.supplier_id;
  }
  const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
  const byName = list.find((s) => norm(s.supplier_name) === norm(name));
  if (byName) return byName.supplier_id;
  return addSupplier(name, vat);
}

export type Pushed =
  | { ok: true; icountId: string | null }
  | { ok: false; error: string };

/**
 * Проводит расход в iCount. Зовётся по нажатию человека, а не само:
 * бухгалтерия — не то место, куда что-то попадает без спроса.
 */
export async function pushExpense(id: string): Promise<Pushed> {
  const e = await expenseById(id);
  if (!e) return { ok: false, error: 'Расход не найден.' };
  if (e.status === 'done') return { ok: true, icountId: e.icount_id };
  if (!e.kind_id || e.icount_type === null) return { ok: false, error: 'Не выбрана группа затрат.' };
  if (!e.supplier) return { ok: false, error: 'Не разобрано, у кого купили.' };
  if (!e.amount) return { ok: false, error: 'Не разобрана сумма.' };
  if (!e.spent_on) return { ok: false, error: 'Не разобрана дата.' };

  try {
    const supplierId = await supplierFor(e.supplier, e.supplier_vat);
    if (!supplierId) return { ok: false, error: 'Поставщик не завёлся в iCount.' };

    const icountId = await createExpense({
      supplierId,
      typeId: e.icount_type,
      docType: e.doc_type ?? 'other',
      docNumber: e.doc_number ?? '',
      sum: Number(e.amount),
      vat: e.vat === null ? null : Number(e.vat),
      date: e.spent_on,
    });

    await query(
      `update expenses set status = 'done', icount_id = $2, icount_sup = $3,
              done_at = now()
        where id = $1`,
      [id, icountId, supplierId],
    );
    return { ok: true, icountId };
  } catch (err) {
    const why = err instanceof Error ? err.message : 'iCount отказал';
    return { ok: false, error: why };
  }
}

export type MonthRow = {
  kind_id: string | null;
  kind_title: string | null;
  n: number;
  sum: string;
};

/** Сколько ушло по статьям за промежуток: ради этого всё и затевалось. */
export async function spentByKind(from: string, to: string): Promise<MonthRow[]> {
  return query<MonthRow>(
    `select e.kind_id, k.title as kind_title, count(*)::int as n,
            coalesce(sum(e.amount), 0)::text as sum
       from expenses e
       left join expense_kinds k on k.id = e.kind_id
      where e.status = 'done' and e.spent_on between $1::date and $2::date
      group by 1, 2
      order by sum(e.amount) desc`,
    [from, to],
  );
}

export type ListRow = Expense & { created_at: string; has_photo: boolean };

/** Чеки за промежуток плюс всё, что ещё ждёт решения. */
export async function expensesIn(from: string, to: string): Promise<ListRow[]> {
  return query<ListRow>(
    `select ${FIELDS}, e.created_at::text,
            (e.photo is not null) as has_photo
       from expenses e
       left join expense_kinds k on k.id = e.kind_id
      where e.status = 'new'
         or (e.spent_on between $1::date and $2::date)
         or (e.spent_on is null and e.created_at >= $1::date)
      order by e.status = 'new' desc, e.spent_on desc nulls first, e.created_at desc`,
    [from, to],
  );
}

/** Сам снимок: страница показывает его по ссылке, а не хранит у себя. */
export async function photoOf(id: string): Promise<{ bytes: Buffer; type: string } | null> {
  const row = await one<{ photo: Buffer | null; photo_type: string | null }>(
    'select photo, photo_type from expenses where id = $1', [id]);
  if (!row?.photo) return null;
  return { bytes: row.photo, type: row.photo_type ?? 'image/jpeg' };
}

/** Прикидка по группам сразу для списка чеков: по одному запросу на всех. */
export async function splitsFor(ids: string[]): Promise<Map<string, Split[]>> {
  if (ids.length === 0) return new Map();
  const rows = await query<{ expense_id: string; kind: string; sum: string; n: number }>(
    `select expense_id, coalesce(kind_guess, 'other') as kind,
            coalesce(sum(sum), 0)::text as sum, count(*)::int as n
       from expense_items where expense_id = any($1::uuid[])
      group by 1, 2 order by sum(sum) desc nulls last`,
    [ids],
  );
  const out = new Map<string, Split[]>();
  for (const r of rows) {
    out.set(r.expense_id, [
      ...(out.get(r.expense_id) ?? []),
      { kind: r.kind, sum: Number(r.sum), n: r.n },
    ]);
  }
  return out;
}

/** Строки чека вместе с их номером: для правки нужен адрес каждой. */
export type LineRow = {
  id: string;
  line_no: number;
  sku: string | null;
  name: string;
  qty: string | null;
  price: string | null;
  sum: string | null;
  kind_guess: string | null;
};

export async function linesOf(ids: string[]): Promise<Map<string, LineRow[]>> {
  if (ids.length === 0) return new Map();
  const rows = await query<LineRow & { expense_id: string }>(
    `select id, expense_id, line_no, sku, name, qty::text, price::text, sum::text, kind_guess
       from expense_items where expense_id = any($1::uuid[]) order by expense_id, line_no`,
    [ids],
  );
  const out = new Map<string, LineRow[]>();
  for (const r of rows) out.set(r.expense_id, [...(out.get(r.expense_id) ?? []), r]);
  return out;
}

/**
 * Меняет группу у одной строки. Человек всегда прав: модель догадывалась,
 * а он смотрит на чек. Общая сумма расхода от этого не меняется — она
 * уже проведена и в бухгалтерии, здесь только наша разбивка.
 */
export async function setLineKind(lineId: string, guess: string): Promise<void> {
  await query('update expense_items set kind_guess = $2 where id = $1', [lineId, guess]);
}
