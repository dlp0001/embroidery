'use server';

import { revalidatePath } from 'next/cache';
import { canTeach, isAdmin, onlyLooking, requireUser } from '@/lib/session';
import { issueReceipt } from '@/lib/billing';
import { WAY, type PayMethod } from '@/lib/format';
import {
  addWalkIn, saveAttendance, sessionHead,
  type AttendanceStatus, type Mark, type PayWay,
} from '@/lib/studio';

const STATUSES: AttendanceStatus[] = ['present', 'absent', 'sick', 'trial'];
const WAYS: PayWay[] = ['none', 'cash', 'pass'];
const METHODS = Object.keys(WAY) as PayMethod[];

/**
 * Ребёнок, которого привели прямо на занятие. Заводим и сразу отмечаем,
 * родителя привяжем потом в «Людях».
 */
export async function addWalkInAction(formData: FormData): Promise<void> {
  if (await onlyLooking()) return;
  const user = await requireUser();
  if (!canTeach(user)) throw new Error('FORBIDDEN');

  const sessionId = String(formData.get('sessionId'));
  const name = String(formData.get('name') ?? '').trim().slice(0, 120);
  if (!name) return;

  const head = await sessionHead(sessionId);
  if (!head) throw new Error('NOT_FOUND');
  if (!isAdmin(user) && head.teacher_id !== user.id) throw new Error('FORBIDDEN');

  const res = await addWalkIn(sessionId, name, user.id);
  revalidatePath('/admin/studio');
  revalidatePath('/admin/studio/people');
  revalidatePath(`/admin/studio/session/${sessionId}`);
  if (!res.ok) throw new Error(res.reason ?? 'BAD_SESSION');
}

export async function saveJournal(formData: FormData): Promise<void> {
  // Из чужих глаз журнал не сохраняется: смотреть можно, вести — нет.
  if (await onlyLooking()) return;
  const user = await requireUser();
  if (!canTeach(user)) throw new Error('FORBIDDEN');

  const sessionId = String(formData.get('sessionId'));
  const head = await sessionHead(sessionId);
  if (!head) throw new Error('NOT_FOUND');
  // Преподаватель ведёт только свои группы, админ — любые.
  if (!isAdmin(user) && head.teacher_id !== user.id) throw new Error('FORBIDDEN');

  // По одной отметке на человека. Форма присылает скрытые поля, и если
  // в ней почему-то оказались две строки про одного и того же (дважды
  // отрисованный журнал, залипшая разметка), брать надо одну: иначе тот
  // же человек проходит по деньгам дважды, и второй проход видит уже не
  // то состояние, что первый.
  const seen = new Map<string, Mark>();
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith('mark:')) continue;
    const status = String(value) as AttendanceStatus;
    if (!STATUSES.includes(status)) continue;
    const participantId = key.slice(5);
    const way = String(formData.get(`pay:${participantId}`) ?? 'none') as PayWay;
    const want = String(formData.get(`receipt:${participantId}`) ?? '') as PayMethod;
    seen.set(participantId, {
      participantId,
      status,
      pay: WAYS.includes(way) ? way : 'none',
      receipt: METHODS.includes(want) ? want : null,
    });
  }
  const marks: Mark[] = [...seen.values()];

  const res = await saveAttendance(sessionId, marks, { id: user.id });
  // Квитанции — после того, как журнал записан: отказ iCount не должен
  // отменять отметки, за которые Варя уже нажала кнопку. Непоявившийся
  // чек останется помеченным в платеже, и следующая попытка его добьёт.
  for (const paymentId of res.bill) await issueReceipt(paymentId);
  // Без redirect: ответ на само действие уже несёт свежую страницу, а
  // переход добавлял к сохранению ещё два похода на сервер.
  revalidatePath('/admin/studio');
  revalidatePath('/admin/studio/debts');
  // Журнал открывают и с отдельной страницы занятия: там тоже обновляем.
  revalidatePath(`/admin/studio/session/${sessionId}`);
}
