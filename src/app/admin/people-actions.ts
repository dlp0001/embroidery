'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { isAdmin, requireUser } from '@/lib/session';
import {
  addChildTo, createParent, renameChildById, renameUser, restoreChild, retireChild,
  setPreferredDay,
} from '@/lib/studio';

async function requireAdmin() {
  const user = await requireUser();
  if (!isAdmin(user)) throw new Error('FORBIDDEN');
  return user;
}

function refresh(): void {
  revalidatePath('/admin/studio/people');
  revalidatePath('/admin/studio');
  revalidatePath('/admin/studio/groups');
  revalidatePath('/account');
}

const text = (form: FormData, key: string, max = 120) =>
  String(form.get(key) ?? '').trim().slice(0, max);

export async function createParentAction(form: FormData): Promise<void> {
  await requireAdmin();
  const email = text(form, 'email', 200).toLowerCase();
  const name = text(form, 'name');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    redirect('/admin/studio/people?error=' + encodeURIComponent('Проверьте адрес почты'));
  }
  await createParent(email, name);
  refresh();
  redirect('/admin/studio/people');
}

export async function renameUserAction(form: FormData): Promise<void> {
  await requireAdmin();
  await renameUser(String(form.get('userId')), text(form, 'name'));
  refresh();
}

export async function addChildAction(form: FormData): Promise<void> {
  await requireAdmin();
  const name = text(form, 'name', 120);
  if (!name) return;
  await addChildTo(String(form.get('userId')), name);
  refresh();
}

export async function renameChildAction(form: FormData): Promise<void> {
  await requireAdmin();
  const name = text(form, 'name', 120);
  if (!name) return;
  await renameChildById(String(form.get('childId')), name);
  refresh();
}

export async function retireChildAction(form: FormData): Promise<void> {
  await requireAdmin();
  const res = await retireChild(String(form.get('childId')));
  refresh();
  // Скрытие — не ошибка, но человек должен понимать, что произошло.
  if (!res.removed && res.name) {
    redirect('/admin/studio/people?note=' + encodeURIComponent(
      `${res.name} скрыт: у него есть посещения или начисления, стереть их нельзя.`));
  }
  redirect('/admin/studio/people');
}

export async function restoreChildAction(form: FormData): Promise<void> {
  await requireAdmin();
  await restoreChild(String(form.get('childId')));
  refresh();
}


/** Приоритетные дни правит и админ, не только сам родитель. */
export async function toggleDayAction(form: FormData): Promise<void> {
  await requireAdmin();
  const weekday = Number(form.get('weekday'));
  if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7) throw new Error('BAD_WEEKDAY');
  await setPreferredDay(String(form.get('participantId')), weekday, String(form.get('on')) === '1');
  refresh();
}
