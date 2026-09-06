'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { declareCash, startPayment, type Intent } from '@/lib/billing';
import { isAdmin, requireUser } from '@/lib/session';

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
  await go({ kind: 'debt', chargeIds: pickedCharges(form) });
}

export async function declareCashAction(form: FormData): Promise<void> {
  const user = await requireUser();
  const res = await declareCash(user, pickedCharges(form));
  if ('error' in res) redirect('/account/pay?error=' + encodeURIComponent(res.error));
  redirect('/account/pay?cash=' + res.count);
}

/** Проверочный платёж на маленькую сумму. Только для админа. */
export async function testPaymentAction(): Promise<void> {
  const user = await requireUser();
  if (!isAdmin(user)) redirect('/account/pay');
  await go({ kind: 'test' });
}

export async function buyPassAction(form: FormData): Promise<void> {
  const lessons = Number(form.get('lessons'));
  if (!Number.isInteger(lessons) || lessons < 1 || lessons > 100) {
    redirect('/account/pay?error=' + encodeURIComponent('Странное число занятий.'));
  }
  await go({ kind: 'pass', lessons });
}
