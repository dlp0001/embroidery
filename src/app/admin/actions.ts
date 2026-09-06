'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { canTeach, isAdmin, requireUser } from '@/lib/session';
import { saveAttendance, sessionHead, type AttendanceStatus, type Mark } from '@/lib/studio';

const STATUSES: AttendanceStatus[] = ['present', 'absent', 'sick', 'trial'];

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
    marks.push({
      participantId,
      status,
      cash: formData.get(`cash:${participantId}`) === '1',
    });
  }

  await saveAttendance(sessionId, marks, { id: user.id });
  revalidatePath('/admin/studio');
  revalidatePath('/admin/studio/debts');
  redirect(`/admin/studio?saved=${sessionId}`);
}
