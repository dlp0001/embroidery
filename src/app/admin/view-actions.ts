'use server';

import { redirect } from 'next/navigation';
import { isSuperadmin, realUser, startActing, stopActing } from '@/lib/session';
import { cabinetOwners } from '@/lib/studio';

/**
 * Открыть чужой кабинет и вернуться к себе. Подмена живёт в куке и
 * ничего не меняет в базе: это способ посмотреть, а не войти за человека.
 */
export async function viewAsAction(formData: FormData): Promise<void> {
  // Спрашиваем настоящего вошедшего: когда чужой кабинет уже открыт,
  // currentUser отвечает тем человеком, а права тут не у него.
  const user = await realUser();
  if (!user || !isSuperadmin(user)) throw new Error('FORBIDDEN');
  const userId = String(formData.get('userId') ?? '');
  if (!userId) redirect('/admin/studio/admin?error=Не выбран человек');
  await startActing(userId);
  // Меняя человека из журнала, в журнале и остаёмся — если новому там
  // есть что показать. Родителя журнал всё равно отправит в кабинет.
  const teaches = (await cabinetOwners()).find((o) => o.id === userId)?.teaches ?? false;
  // Кто ведёт занятия, того смотрим в журнале: кабинета у него нет.
  redirect(teaches ? '/admin/studio' : '/account');
}

export async function stopViewAction(): Promise<void> {
  await stopActing();
  redirect('/admin/studio/admin');
}
