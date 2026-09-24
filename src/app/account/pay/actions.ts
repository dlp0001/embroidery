'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import {
  declareCash, declineCash, dropPayment, myPendingCash, startPayment, type Intent,
} from '@/lib/billing';
import { cashDeclared } from '@/lib/notify';
import { isAdmin, onlyLooking, requireUser } from '@/lib/session';

/** Адрес сайта берём из запроса, чтобы совпадал и на превью, и на проде. */
async function origin(): Promise<string> {
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:4321';
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
}

async function go(intent: Intent): Promise<never> {
  const user = await requireUser();
  const res = await startPayment(user, intent, await origin());
  if ('error' in res) redirect(`/account/pay?error=${encodeURIComponent(res.error)}`);
  // Сразу в кассу, без промежуточного экрана. Ссылка остаётся в записи
  // платежа, поэтому /account/pay/go/<id> работает как запасной путь.
  redirect(res.url);
}

/** Занятия, отмеченные галочками. Пусто — значит все. */
function pickedCharges(form: FormData): string[] {
  return form.getAll('charge').map(String).filter(Boolean);
}

export async function payDebtAction(form: FormData): Promise<void> {
  if (await onlyLooking()) return;
  await go({ kind: 'debt', chargeIds: pickedCharges(form) });
}

/** «Наличные» и «Перевод» — одна и та же заявка, разный способ. */
async function declare(form: FormData, way: 'cash' | 'transfer'): Promise<never> {
  const user = await requireUser();
  const res = await declareCash(user, pickedCharges(form), way);
  if ('error' in res) redirect('/account/pay?error=' + encodeURIComponent(res.error));
  // Пока заявку не подтвердили, деньги висят незачтёнными, а увидеть это
  // можно только открыв «Финансы». Говорим Варе сразу.
  await cashDeclared(user.id);
  redirect('/account/pay?cash=' + res.count);
}

export async function declareCashAction(form: FormData): Promise<void> {
  if (await onlyLooking()) return;
  await declare(form, 'cash');
}

export async function declareTransferAction(form: FormData): Promise<void> {
  if (await onlyLooking()) return;
  await declare(form, 'transfer');
}

/**
 * Родитель передумал платить напрямую. Занятия снова становятся
 * неоплаченными и их можно выбрать заново.
 */
export async function cancelCashAction(): Promise<void> {
  if (await onlyLooking()) return;
  const user = await requireUser();
  const claim = await myPendingCash(user.id);
  // Отменять можно только свою заявку и только пока её не подтвердили.
  if (claim) await declineCash(claim.id, user.id, 'родитель отменил заявку');
  redirect('/account/pay');
}

/** Начатый платёж картой, который решили не доводить до конца. */
export async function dropPaymentAction(form: FormData): Promise<void> {
  if (await onlyLooking()) return;
  const user = await requireUser();
  await dropPayment(String(form.get('id') ?? ''), user.id);
  redirect('/account/pay');
}

/** Проверочный платёж на маленькую сумму. Только для админа. */
export async function testPaymentAction(): Promise<void> {
  if (await onlyLooking()) return;
  const user = await requireUser();
  if (!isAdmin(user)) redirect('/account/pay');
  await go({ kind: 'test' });
}

export async function buyPassAction(form: FormData): Promise<void> {
  if (await onlyLooking()) return;
  // Один ключ «id группы:дней»: пакет лагеря не перепутать с абонементом.
  const [groupId, lessonsKey] = String(form.get('offer') ?? '').split(':');
  const lessons = Number(lessonsKey);
  if (!Number.isInteger(lessons) || lessons < 1 || lessons > 100) {
    redirect('/account/pay?error=' + encodeURIComponent('Странное число занятий.'));
  }
  await go({ kind: 'pass', lessons, groupId: groupId || null });
}
