'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { one } from '@/lib/db';
import { telegramNick } from '@/lib/format';
import { requireUser } from '@/lib/session';
import {
  addChild, renameChild, saveProfile, setAttends, setBooking, setPreferredDay,
} from '@/lib/studio';

/** Участник принадлежит семье вошедшего? */
async function assertOwn(userId: string, participantId: string): Promise<void> {
  const ok = await one(
    `select 1 from participants p
      where p.id = $1
        and (p.user_id = $2 or p.child_id in (select child_id from guardians where user_id = $2))`,
    [participantId, userId],
  );
  if (!ok) throw new Error('FORBIDDEN');
}

function refresh(): void {
  revalidatePath('/account');
  revalidatePath('/account/calendar');
  revalidatePath('/account/profile');
  // На лагерь записывают и с публичной страницы: она тоже живая.
  revalidatePath('/camp');
}

export async function toggleBooking(formData: FormData): Promise<void> {
  const user = await requireUser();
  const sessionId = String(formData.get('sessionId'));
  const participantId = String(formData.get('participantId'));
  const booked = String(formData.get('booked')) === '1';
  await assertOwn(user.id, participantId);
  await setBooking(sessionId, participantId, booked);
  refresh();
}

export async function togglePreferredDay(formData: FormData): Promise<void> {
  const user = await requireUser();
  const participantId = String(formData.get('participantId'));
  const weekday = Number(formData.get('weekday'));
  const on = String(formData.get('on')) === '1';
  if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7) throw new Error('BAD_WEEKDAY');
  await assertOwn(user.id, participantId);
  await setPreferredDay(participantId, weekday, on);
  refresh();
}

export async function createChild(formData: FormData): Promise<void> {
  const user = await requireUser();
  const name = String(formData.get('name') ?? '').trim().slice(0, 120);
  if (!name) return;
  await addChild(user.id, name);
  refresh();
}

/** Ходит ли взрослый на занятия сам. Пока не сказал — считаем, что нет. */
export async function setMyAttendance(formData: FormData): Promise<void> {
  const user = await requireUser();
  await setAttends(user.id, String(formData.get('on')) === '1');
  refresh();
}

/**
 * Свою карточку родитель правит сам: раньше её мог поменять только админ.
 * Ник в телеграме необязателен, но если уж написан — должен быть ником,
 * иначе по нему всё равно никто не напишет.
 */
export async function updateMyProfile(formData: FormData): Promise<void> {
  const user = await requireUser();
  const name = String(formData.get('name') ?? '').trim().slice(0, 120);
  const tg = telegramNick(String(formData.get('telegram') ?? '').slice(0, 80));
  if (!tg.ok) {
    redirect('/account/profile?error=' + encodeURIComponent(
      'Ник в телеграме — латиница, цифры и подчёркивание, от пяти знаков. Например @anna_liberman'));
  }
  await saveProfile(user.id, name, tg.nick);
  refresh();
  redirect('/account/profile');
}

export async function updateChild(formData: FormData): Promise<void> {
  const user = await requireUser();
  const childId = String(formData.get('childId'));
  const name = String(formData.get('name') ?? '').trim().slice(0, 120);
  if (!name) return;
  await renameChild(user.id, childId, name);
  refresh();
}
