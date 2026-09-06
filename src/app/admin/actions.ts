'use server';

import { revalidatePath } from 'next/cache';
import { canTeach, isAdmin, requireUser } from '@/lib/session';
import { saveAttendance, sessionHead, type AttendanceStatus, type Mark, type PayWay } from '@/lib/studio';

const STATUSES: AttendanceStatus[] = ['present', 'absent', 'sick', 'trial'];
const WAYS: PayWay[] = ['none', 'cash', 'pass'];

export async function saveJournal(formData: FormData): Promise<void> {
  const user = await requireUser();
  if (!canTeach(user)) throw new Error('FORBIDDEN');

  const sessionId = String(formData.get('sessionId'));
  const head = await sessionHead(sessionId);
  if (!head) throw new Error('NOT_FOUND');
  // Преподаватель ведёт только свои группы, админ — любые.
  if (!isAdmin(user) && head.teacher_id !== user.id) throw new Error('FORBIDDEN');

  const marks: Mark[] = [];
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith('mark:')) continue;
    const status = String(value) as AttendanceStatus;
    if (!STATUSES.includes(status)) continue;
    const participantId = key.slice(5);
    const way = String(formData.get(`pay:${participantId}`) ?? 'none') as PayWay;
    marks.push({
      participantId,
      status,
      pay: WAYS.includes(way) ? way : 'none',
    });
  }

  await saveAttendance(sessionId, marks, { id: user.id });
  // Без redirect: ответ на само действие уже несёт свежую страницу, а
  // переход добавлял к сохранению ещё два похода на сервер.
  revalidatePath('/admin/studio');
  revalidatePath('/admin/studio/debts');
  // Журнал открывают и с отдельной страницы занятия: там тоже обновляем.
  revalidatePath(`/admin/studio/session/${sessionId}`);
}
