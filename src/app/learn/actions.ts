'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { redeemLink, requestLink } from '@/lib/course';

export type OpenState = { error?: 'unknown' | 'expired' | 'full' };

/**
 * Кнопка «Открыть курс» на странице ссылки. Устройство заводится здесь, а
 * не при открытии страницы: почтовые сканеры сами переходят по ссылкам из
 * писем, и без кнопки каждый такой переход съедал бы одно из трёх мест.
 */
export async function openCourseAction(_prev: OpenState, form: FormData): Promise<OpenState> {
  const token = String(form.get('token') ?? '');
  const ua = (await headers()).get('user-agent');
  const res = await redeemLink(token, ua);
  if (!res.ok) return { error: res.reason };
  redirect(`/learn/${res.slug}`);
}

export type LinkState = { sent?: boolean; email?: string; error?: string };

export async function requestLinkAction(_prev: LinkState, form: FormData): Promise<LinkState> {
  const slug = String(form.get('course') ?? '');
  const email = String(form.get('email') ?? '').trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return { email, error: 'Проверьте адрес почты' };
  }
  const ok = await requestLink(slug, email);
  if (!ok) {
    return { email, error: 'Письмо не ушло. Напишите на info@re-create.art, пришлём ссылку руками.' };
  }
  return { sent: true, email };
}
