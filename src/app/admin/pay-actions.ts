'use server';

import { revalidatePath } from 'next/cache';
import { after } from 'next/server';
import { issueReceipt, takeCash } from '@/lib/billing';
import { cashConfirmed } from '@/lib/notify';
import { WAYS, type PayMethod } from '@/lib/format';
import { isAdmin, onlyLooking, requireUser } from '@/lib/session';
import type { SaveResult } from '@/components/AutoSave';

async function requireAdmin() {
  const user = await requireUser();
  if (!isAdmin(user)) throw new Error('FORBIDDEN');
  return user;
}

function refresh(): void {
  revalidatePath('/admin/studio/pay');
  revalidatePath('/admin/studio/debts');
  revalidatePath('/admin/studio');
  revalidatePath('/account');
  revalidatePath('/account/pay');
}

/**
 * Деньги принесли в студию: Варя отметила занятия и назвала способ.
 *
 * Отвечает результатом, а не переходом: сказать «эти занятия уже закрыты»
 * надо там же, где их отмечали, а не на новой странице.
 */
export async function takeCashAction(form: FormData): Promise<SaveResult> {
  if (await onlyLooking()) return { ok: false, error: 'Только смотрите: менять нельзя.' };
  const user = await requireAdmin();

  const ownerId = String(form.get('ownerId') ?? '');
  const chargeIds = form.getAll('charge').map(String).filter(Boolean);
  const raw = String(form.get('payMethod') ?? '');
  const method = WAYS.find((w) => w === raw) as PayMethod | undefined;
  if (!ownerId) return { ok: false, error: 'Выберите, кто платит.' };
  if (!method) return { ok: false, error: 'Выберите способ оплаты.' };
  const receipt = form.get('receipt') === 'on';

  const done = await takeCash({ ownerId, chargeIds, method, receipt }, user.id);
  if (!done.ok || !done.paymentId) {
    return { ok: false, error: done.error ?? 'Не получилось провести оплату.' };
  }

  // Квитанция и письмо родителю — после ответа: iCount и телеграм не
  // должны держать экран, за которым стоит человек с деньгами.
  const paymentId = done.paymentId;
  after(async () => {
    if (receipt) await issueReceipt(paymentId);
    await cashConfirmed(paymentId);
  });

  refresh();
  return { ok: true };
}
