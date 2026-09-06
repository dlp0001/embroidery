'use server';

import { redirect } from 'next/navigation';
import { requestCode, verifyCode } from '@/lib/auth';
import { canTeach, currentUser, destroySession } from '@/lib/session';

export type LoginState = { step: 'email' | 'code'; email: string; error?: string; devCode?: string };

export async function sendCodeAction(prev: LoginState, form: FormData): Promise<LoginState> {
  const email = String(form.get('email') ?? '');
  const res = await requestCode(email);
  if (!res.ok) return { step: 'email', email, error: res.error };
  return { step: 'code', email: email.trim().toLowerCase(), devCode: res.devCode };
}

export async function verifyCodeAction(prev: LoginState, form: FormData): Promise<LoginState> {
  const email = String(form.get('email') ?? prev.email);
  const code = String(form.get('code') ?? '');
  const res = await verifyCode(email, code);
  if (!res.ok) return { step: 'code', email, error: res.error };
  // Кто ведёт занятия, тому нужен журнал, а не родительский кабинет.
  const user = await currentUser();
  if (user && canTeach(user)) redirect('/admin/studio');
  // Новичку показывать нечего, пока он не сказал, кто ходит в студию.
  redirect(res.created ? '/account/profile' : '/account');
}

export async function logoutAction(): Promise<void> {
  await destroySession();
  redirect('/');
}
