'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { isAdmin, onlyLooking, requireUser } from '@/lib/session';
import { issueReceiptFor } from '@/lib/billing';
import { query } from '@/lib/db';

/**
 * Сколько бумаг выписываем за один заход. iCount отвечает за секунду-две,
 * но в плохой день ждёт двенадцать, а у страницы всего минута: лучше
 * выписать десять и сказать об этом, чем упереться в таймаут посреди
 * одиннадцатой и не узнать, какие прошли.
 */
const AT_ONCE = 10;

/** Платежей в заход больше, чем бумаг: в одну их складывается много. */
const MAX_IDS = 100;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Выписывает квитанции по выбранным платежам. Платежи одного плательщика,
 * пришедшие одним способом, складываются в одну бумагу — этим занимается
 * issueReceiptFor, здесь только отбор и отчёт.
 *
 * Перед отправкой помечаем платёж «чек нужен»: выписка идёт тем же
 * отбором, что и автоматическая, а он пропускает деньги, по которым
 * бумагу не просили. Нажатие на этой странице и есть просьба — пусть она
 * останется в платеже, чтобы следующая попытка знала о ней.
 */
export async function issueReceiptsAction(formData: FormData): Promise<void> {
  if (await onlyLooking()) return;
  const user = await requireUser();
  if (!isAdmin(user)) throw new Error('FORBIDDEN');

  const ids = formData.getAll('pay')
    .map(String)
    .filter((id) => UUID.test(id))
    .slice(0, MAX_IDS);
  if (ids.length === 0) return;

  // Только те, где квитанции и правда нет: повторное нажатие на уже
  // выписанное ничего не меняет и просьбу задним числом не пишет.
  const asked = await query<{ id: string }>(
    `update payments
        set raw = coalesce(raw, '{}'::jsonb) || jsonb_build_object(
                    'receipt_wanted', 'yes',
                    'receipt_asked_at', now()::text)
      where id = any($1::uuid[]) and status = 'paid'
        and invoice_url is null and raw -> 'receipt' is null
      returning id`,
    [ids],
  );

  const { docs, failed } = await issueReceiptFor(asked.map((r) => r.id), AT_ONCE);

  revalidatePath('/admin/studio/receipts');
  revalidatePath('/admin/studio/payments');

  // Возвращаем с отчётом: молчание после нажатия неотличимо от «ничего
  // не произошло», а произойти могло и половина.
  const where = new URLSearchParams({ issue: '1', done: String(docs), failed: String(failed) });
  const from = String(formData.get('from') ?? '');
  const to = String(formData.get('to') ?? '');
  if (from) where.set('from', from);
  if (to) where.set('to', to);
  redirect(`/admin/studio/receipts?${where}`);
}
