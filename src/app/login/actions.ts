'use server';

import { redirect } from 'next/navigation';
import { requestCode, verifyCode } from '@/lib/auth';
import { destroySession } from '@/lib/session';

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
  redirect('/account');
}

export async function logoutAction(): Promise<void> {
  await destroySession();
  redirect('/');
}
