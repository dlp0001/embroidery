import { one, query } from './db';
import { addSupplier, createExpense, suppliers } from './icount';
import type { Scanned } from './vision';

/**
 * Расходы студии: снимок чека, разобранные поля и своя структура затрат.
 *
 * Группы наши, потому что вопрос «сколько ушло на материалы для лагеря»
 * задаёт студия, а не бухгалтерия: у iCount видов расхода три, и заведены
 * они под отчётность. Каждая наша группа знает, во что превращается там.
 */

export type Kind = { id: string; title: string; icount_type: number };

export async function kinds(): Promise<Kind[]> {
  return query<Kind>(
    `select id, title, icount_type from expense_kinds
      where active order by sort, title`,
  );
}

export type Expense = {
  id: string;
  supplier: string | null;
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

const FIELDS = `e.id, e.supplier, e.supplier_vat, e.doc_type, e.doc_number,
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

/** Кладёт снимок и то, что из него прочитали. Дальше его смотрит человек. */
export async function saveReceipt(input: {
  photo: Buffer;
  photoType: string;
  userId: string | null;
  chatId: number;
  scan: Scanned | null;
  error?: string | null;
}): Promise<string> {
  const s = input.scan;
  const row = await one<{ id: string }>(
    `insert into expenses
       (photo, photo_type, supplier, supplier_vat, doc_type, doc_number,
        spent_on, amount, vat, currency, user_id, chat_id, raw)
     values ($1, $2, $3, $4, $5, $6, $7::date, $8, $9, $10, $11, $12, $13::jsonb)
     returning id`,
    [
      input.photo, input.photoType,
      s?.supplier ?? null, s?.supplier_vat ?? null, s?.doc_type ?? null, s?.doc_number ?? null,
      s?.spent_on ?? null, s?.amount ?? null, s?.vat ?? null, s?.currency ?? 'ILS',
      input.userId, input.chatId,
      JSON.stringify({ ...(s ?? {}), ...(input.error ? { error: input.error } : {}) }),
    ],
  );
  return row!.id;
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
