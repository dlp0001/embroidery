'use server';

import { redirect } from 'next/navigation';
import { requestCode, verifyCode } from '@/lib/auth';
import { acceptInvite } from '@/lib/family';
import { checkForm } from '@/lib/form-guard';
import { currentUser } from '@/lib/session';

export type JoinState = {
  step: 'who' | 'code' | 'stuck';
  email: string;
  name: string;
  error?: string;
  devCode?: string;
};

/** Имя и почта второго родителя: дальше вход тот же, что у всех. */
export async function joinSendCode(prev: JoinState, form: FormData): Promise<JoinState> {
  const email = String(form.get('email') ?? '').trim().toLowerCase();
  const name = String(form.get('name') ?? '').trim();
  const verdict = checkForm(form);
  if (verdict === 'bot') {
    // Делаем вид, что код ушёл: письма нет, а бот не узнает, что его поймали.
    console.warn('join: бот, письмо не отправлено', email);
    return { step: 'code', email, name };
  }
  if (verdict === 'fast') return { ...prev, step: 'who', email, name, error: 'Секунду! Нажмите ещё раз.' };
  if (verdict === 'stale') {
    return { ...prev, step: 'who', email, name, error: 'Страница устарела. Обновите её и попробуйте ещё раз.' };
  }
  if (!name) return { step: 'who', email, name, error: 'Напишите, как вас зовут' };

  const res = await requestCode(email);
  if (!res.ok) return { step: 'who', email, name, error: res.error };
  return { step: 'code', email, name, devCode: res.devCode };
}

/**
 * Код из письма — и сразу в семью. Код тут не лишний замок: он же и
 * заводит учётку. Без него человек, ошибшийся в адресе, потом не смог бы
 * войти обычным входом — письма на тот адрес не приходят.
 */
export async function joinVerify(prev: JoinState, form: FormData): Promise<JoinState> {
  const token = String(form.get('token') ?? '');
  const email = String(form.get('email') ?? prev.email);
  const name = String(form.get('name') ?? prev.name);
  const code = String(form.get('code') ?? '');

  const res = await verifyCode(email, code);
  if (!res.ok) return { ...prev, step: 'code', email, name, error: res.error };

  const user = await currentUser();
  if (!user) return { step: 'stuck', email, name, error: 'Вход не сохранился. Попробуйте ещё раз.' };

  const joined = await acceptInvite(token, user.id, name);
  if (!joined.ok) return { step: 'stuck', email, name, error: joined.error };
  redirect('/account');
}

/** Второй родитель уже входил сюда раньше: кода не спрашиваем. */
export async function joinAsMe(form: FormData): Promise<void> {
  const token = String(form.get('token') ?? '');
  const user = await currentUser();
  if (!user) redirect('/login');
  const joined = await acceptInvite(token, user.id);
  redirect(joined.ok ? '/account' : `/join/${token}?error=1`);
}
