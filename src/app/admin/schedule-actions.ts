'use server';

import { revalidatePath } from 'next/cache';
import { isAdmin, requireUser } from '@/lib/session';
import {
  addSession, createGroup, deleteSession, resyncGroupSessions, setGroupActive,
  setSessionStatus, updateGroup, type GroupInput,
} from '@/lib/studio';

/** Расписание правят админ и суперадмин. Преподавателю сюда нельзя. */
async function requireAdmin() {
  const user = await requireUser();
  if (!isAdmin(user)) throw new Error('FORBIDDEN');
  return user;
}

function refresh(): void {
  revalidatePath('/admin/studio');
  revalidatePath('/admin/studio/groups');
  revalidatePath('/admin/studio/calendar');
  revalidatePath('/account');
  revalidatePath('/account/calendar');
}

function readGroup(form: FormData): GroupInput {
  const num = (key: string) => {
    const raw = String(form.get(key) ?? '').trim();
    return raw === '' ? null : Number(raw);
  };
  const text = (key: string) => {
    const raw = String(form.get(key) ?? '').trim();
    return raw === '' ? null : raw.slice(0, 120);
  };

  const weekday = num('weekday');
  const audience = String(form.get('audience') ?? 'kids');
  if (!weekday || weekday < 1 || weekday > 7) throw new Error('BAD_WEEKDAY');
  if (audience !== 'kids' && audience !== 'adults') throw new Error('BAD_AUDIENCE');

  const title = text('title');
  if (!title) throw new Error('BAD_TITLE');

  return {
    title,
    weekday,
    startsAt: String(form.get('startsAt') ?? '').slice(0, 5) || '16:00',
    durationMin: num('durationMin') ?? 90,
    audience,
    ageHint: text('ageHint'),
    capacity: num('capacity'),
    room: text('room'),
    teacherId: text('teacherId'),
  };
}

export async function createGroupAction(form: FormData): Promise<void> {
  await requireAdmin();
  const id = await createGroup(readGroup(form));
  // Сразу расставляем занятия, иначе новая группа висит без расписания.
  await resyncGroupSessions(id);
  refresh();
}

export async function updateGroupAction(form: FormData): Promise<void> {
  await requireAdmin();
  const id = String(form.get('id'));
  await updateGroup(id, readGroup(form));
  // День или время могли измениться — переносим будущие пустые занятия.
  await resyncGroupSessions(id);
  refresh();
}

export async function toggleGroupAction(form: FormData): Promise<void> {
  await requireAdmin();
  const id = String(form.get('id'));
  const active = String(form.get('active')) === '1';
  await setGroupActive(id, active);
  await resyncGroupSessions(id);
  refresh();
}

export async function addSessionAction(form: FormData): Promise<void> {
  await requireAdmin();
  const groupId = String(form.get('groupId'));
  const heldOn = String(form.get('heldOn'));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(heldOn)) throw new Error('BAD_DATE');
  await addSession(groupId, heldOn);
  refresh();
}

export async function setSessionStatusAction(form: FormData): Promise<void> {
  await requireAdmin();
  const status = String(form.get('status'));
  if (status !== 'planned' && status !== 'cancelled') throw new Error('BAD_STATUS');
  await setSessionStatus(String(form.get('id')), status);
  refresh();
}

export async function deleteSessionAction(form: FormData): Promise<void> {
  await requireAdmin();
  const res = await deleteSession(String(form.get('id')));
  if (!res.ok) throw new Error(res.reason);
  refresh();
}
