'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { grantAccess, sendLink } from '@/lib/course';
import { issueCourseReceipt } from '@/lib/course-pay';
import { payplusCard, resetDevices, restore, revoke } from '@/lib/course-admin';
import { legacyBuyers } from '@/lib/course-legacy';
import { currentUser, isAdmin, isSuperadmin } from '@/lib/session';

const PAGE = '/admin/courses';

async function guard(): Promise<void> {
  const user = await currentUser();
  if (!user || !isAdmin(user)) redirect('/admin/studio');
}

function back(params: Record<string, string>): never {
  redirect(`${PAGE}?${new URLSearchParams(params)}`);
}

/** Доступ без оплаты: подарок, обмен, оплата мимо сайта. Письмо уходит сразу. */
export async function grantCourseAction(form: FormData): Promise<void> {
  await guard();
  const email = String(form.get('email') ?? '').trim().toLowerCase();
  const name = String(form.get('name') ?? '').trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) back({ error: 'Проверьте адрес почты' });
  const grant = await grantAccess({ slug: 'embroidery', email, name: name || null, source: 'manual' });
  const sent = await sendLink(grant.accessId);
  revalidatePath(PAGE);
  back(sent
    ? { note: `Доступ открыт, ссылка ушла на ${email}` }
    : { error: `Доступ открыт, но письмо на ${email} не ушло` });
}

export async function resendLinkAction(form: FormData): Promise<void> {
  await guard();
  const id = String(form.get('id') ?? '');
  const sent = await sendLink(id);
  revalidatePath(PAGE);
  back(sent ? { note: 'Новая ссылка отправлена, старая больше не работает' } : { error: 'Письмо не ушло' });
}

export async function resetDevicesAction(form: FormData): Promise<void> {
  await guard();
  await resetDevices(String(form.get('id') ?? ''));
  revalidatePath(PAGE);
  back({ note: 'Устройства сброшены. Чтобы вернуться в курс, понадобится свежая ссылка.' });
}

export async function revokeAction(form: FormData): Promise<void> {
  await guard();
  await revoke(String(form.get('id') ?? ''));
  revalidatePath(PAGE);
  back({ note: 'Доступ отозван' });
}

export async function restoreAction(form: FormData): Promise<void> {
  await guard();
  await restore(String(form.get('id') ?? ''));
  revalidatePath(PAGE);
  back({ note: 'Доступ возвращён. Отправьте ссылку: прежняя была погашена при отзыве.' });
}

/** Сколько старых покупателей переносим за одно нажатие: время запроса ограничено. */
const LEGACY_BATCH = 20;

/**
 * Покупатели первого потока из Sheets: открыть доступ на 6 месяцев и
 * написать, что записи переехали. Только суперадмин — это рассылка всем
 * сразу. Повторное нажатие берёт следующих: у перенесённых доступ уже есть.
 */
export async function importLegacyAction(): Promise<void> {
  const user = await currentUser();
  if (!user || !isSuperadmin(user)) redirect(PAGE);

  const { buyers } = await legacyBuyers('embroidery');
  const todo = buyers.filter((b) => !b.hasAccess);
  const batch = todo.slice(0, LEGACY_BATCH);
  const failed: string[] = [];
  for (const b of batch) {
    const grant = await grantAccess({ slug: 'embroidery', email: b.email, name: b.name, source: 'legacy' });
    if (!(await sendLink(grant.accessId, 'moved'))) failed.push(b.email);
    // Resend принимает не больше двух писем в секунду.
    await new Promise((r) => setTimeout(r, 600));
  }
  revalidatePath(PAGE);
  const left = todo.length - batch.length;
  back({
    legacy: '1',
    ...(failed.length
      ? { error: `Доступ открыт ${batch.length}, письма не ушли: ${failed.join(', ')}. Им — «Прислать ссылку». Осталось ${left}.` }
      : { note: `Доступ открыт и письма ушли: ${batch.length}. Осталось ${left}.` }),
  });
}

export async function retryReceiptAction(form: FormData): Promise<void> {
  await guard();
  const providerId = String(form.get('payplusId') ?? '');
  await issueCourseReceipt(providerId, await payplusCard(providerId));
  revalidatePath(PAGE);
  back({ note: 'Квитанция отправлена ещё раз — посмотрите статус в строке' });
}
