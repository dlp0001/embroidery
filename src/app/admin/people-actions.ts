'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { plural } from '@/lib/format';
import { isAdmin, requireUser } from '@/lib/session';
import {
  addChildTo, createParent, linkChild, renameChildById, restoreChild, retireChild,
  saveParent, setPreferredDay,
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
  const billing = text(form, 'billingName');
  // Квитанции уходят в израильскую отчётность, там все имена пишутся
  // одинаково. Кириллицу и иврит в это поле не пускаем.
  if (billing && /[^\u0020-\u007E]/.test(billing)) {
    redirect('/admin/studio/people?error='
      + encodeURIComponent('Имя для квитанции пишется латиницей'));
  }
  await saveParent(String(form.get('userId')), text(form, 'name'), billing);
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

/**
 * Привязывает ребёнка, которого привели без родителя, к взрослому.
 * По умолчанию переносит на него и уже случившиеся занятия: до привязки
 * они посчитаны, но лежат без плательщика.
 */
export async function linkChildAction(form: FormData): Promise<void> {
  const admin = await requireAdmin();
  const childId = String(form.get('childId'));
  const userId = String(form.get('userId'));
  if (!userId) return;
  const res = await linkChild(childId, userId, form.get('takePast') === 'on', admin.id);
  refresh();
  revalidatePath('/admin/studio/debts');
  const total = res.moved + res.counted;
  redirect('/admin/studio/people?note=' + encodeURIComponent(
    total > 0
      ? `Привязали. ${total} ${plural(total, 'занятие', 'занятия', 'занятий')} записано на этого родителя${
          res.counted > 0 ? `, из них ${res.counted} посчитано впервые` : ''}. Абонемент не тронут: если занятие шло по нему, поставьте это в журнале.`
      : 'Привязали. Прошлых занятий не было.'));
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
