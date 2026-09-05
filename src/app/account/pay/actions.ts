'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { startPayment, type Intent } from '@/lib/billing';
import { requireUser } from '@/lib/session';

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
  // Уводим на свою страницу: переход на чужой адрес прямо из формы
  // ведёт себя по-разному, а тут человек в любом случае видит кнопку.
  redirect(`/account/pay/go/${res.paymentId}`);
}

export async function payDebtAction(): Promise<void> {
  await go({ kind: 'debt' });
}

export async function buyPassAction(form: FormData): Promise<void> {
  const lessons = Number(form.get('lessons'));
  const months = Number(form.get('months') ?? 3);
  if (!Number.isInteger(lessons) || lessons < 1 || lessons > 100) {
    redirect('/account/pay?error=' + encodeURIComponent('Странное число занятий.'));
  }
  await go({ kind: 'pass', lessons, months });
}
