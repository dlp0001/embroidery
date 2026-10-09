'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { isAdmin, onlyLooking, requireUser } from '@/lib/session';
import { issueReceipt } from '@/lib/billing';
import { query } from '@/lib/db';

/**
 * Сколько квитанций берём за один заход. iCount отвечает за секунду-две,
 * но в плохой день ждёт двенадцать, а у страницы всего минута: лучше
 * выписать десять и сказать об этом, чем упереться в таймаут посреди
 * одиннадцатой и не узнать, какие прошли.
 */
const AT_ONCE = 10;

/** Докуда продолжаем: остаток минуты нужен самой странице. */
const BUDGET_MS = 40_000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Выписывает квитанции по выбранным платежам.
 *
 * Перед отправкой помечаем платёж «чек нужен»: issueReceipt идёт через
 * тот же отбор, что и автоматическая выписка, а он пропускает деньги, по
 * которым бумагу не просили. Нажатие на этой странице и есть просьба —
 * пусть она останется в платеже, чтобы следующая попытка знала о ней.
 */
export async function issueReceiptsAction(formData: FormData): Promise<void> {
  if (await onlyLooking()) return;
  const user = await requireUser();
  if (!isAdmin(user)) throw new Error('FORBIDDEN');

  const ids = formData.getAll('pay')
    .map(String)
    .filter((id) => UUID.test(id))
    .slice(0, AT_ONCE);
  if (ids.length === 0) return;

  let done = 0;
  let failed = 0;
  const until = Date.now() + BUDGET_MS;
  for (const id of ids) {
    if (Date.now() > until) break;
    // Только по тем, где квитанции и правда нет: повторное нажатие на
    // уже выписанное ничего не меняет и просьбу задним числом не пишет.
    const asked = await query<{ id: string }>(
      `update payments
          set raw = coalesce(raw, '{}'::jsonb) || jsonb_build_object(
                      'receipt_wanted', 'yes',
                      'receipt_asked_at', now()::text)
        where id = $1 and status = 'paid'
          and invoice_url is null and raw -> 'receipt' is null
        returning id`,
      [id],
    );
    if (asked.length === 0) continue;
    await issueReceipt(id);
    // Вышла ли бумага, спрашиваем у платежа: issueReceipt глотает отказ
    // iCount нарочно — деньги важнее бумажки, — и наружу ничего не отдаёт.
    const after = await query<{ ok: boolean }>(
      `select (invoice_url is not null or raw ? 'receipt') as ok
         from payments where id = $1`,
      [id],
    );
    if (after[0]?.ok) done++; else failed++;
  }

  revalidatePath('/admin/studio/receipts');
  revalidatePath('/admin/studio/payments');

  // Возвращаем с отчётом: молчание после нажатия неотличимо от «ничего
  // не произошло», а произойти могло и половина.
  const where = new URLSearchParams({ issue: '1', done: String(done), failed: String(failed) });
  const from = String(formData.get('from') ?? '');
  const to = String(formData.get('to') ?? '');
  if (from) where.set('from', from);
  if (to) where.set('to', to);
  redirect(`/admin/studio/receipts?${where}`);
}
