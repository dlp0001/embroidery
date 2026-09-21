'use server';

import { redirect } from 'next/navigation';
import { optIn, optOut, tokenOk, unsubToken } from '@/lib/mail';

/**
 * Отписка нажатием кнопки, а не переходом по ссылке: почтовые клиенты
 * и антивирусы открывают ссылки из писем сами, и человек оказался бы
 * отписан, ни на что не нажав.
 */
export async function optOutAction(form: FormData): Promise<void> {
  const email = String(form.get('email') ?? '').trim().toLowerCase();
  const token = String(form.get('token') ?? '');
  if (!email || !tokenOk(email, token)) redirect('/unsubscribe?bad=1');
  await optOut(email);
  redirect(`/unsubscribe?done=1&e=${encodeURIComponent(email)}&t=${unsubToken(email)}`);
}

/** Передумал: адрес возвращается в рассылку. */
export async function optInAction(form: FormData): Promise<void> {
  const email = String(form.get('email') ?? '').trim().toLowerCase();
  const token = String(form.get('token') ?? '');
  if (!email || !tokenOk(email, token)) redirect('/unsubscribe?bad=1');
  await optIn(email);
  redirect(`/unsubscribe?back=1&e=${encodeURIComponent(email)}&t=${unsubToken(email)}`);
}
