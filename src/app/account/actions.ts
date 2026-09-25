'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { SaveResult } from '@/components/AutoSave';
import { one } from '@/lib/db';
import { telegramNick } from '@/lib/format';
import { onlyLooking, requireUser } from '@/lib/session';
import { linkUrl, unlinkUser } from '@/lib/telegram';
import {
  addChild, renameChild, saveProfile, sessionIsPast, setAttends, setBooking, setPreferredDay,
} from '@/lib/studio';

/** Чужой кабинет открыт на просмотр: менять в нём нельзя. */
const LOOKING: SaveResult = { ok: false, error: 'Это чужой кабинет: отсюда только смотрят.' };

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
  if (await onlyLooking()) return;
  const user = await requireUser();
  const sessionId = String(formData.get('sessionId'));
  const participantId = String(formData.get('participantId'));
  const booked = String(formData.get('booked')) === '1';
  await assertOwn(user.id, participantId);
  // Записаться назад нельзя: занятие прошло, и «приду» про него — неправда.
  // Кнопки для прошедшего дня на экране нет, так что сюда доходит разве что
  // вкладка, открытая вчера. Ей просто показываем, как всё обстоит сейчас.
  if (booked && await sessionIsPast(sessionId)) {
    refresh();
    return;
  }
  await setBooking(sessionId, participantId, booked, { userId: user.id, via: 'cabinet' });
  refresh();
}

export async function togglePreferredDay(formData: FormData): Promise<void> {
  if (await onlyLooking()) return;
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
  if (await onlyLooking()) return;
  const user = await requireUser();
  const name = String(formData.get('name') ?? '').trim().slice(0, 120);
  if (!name) return;
  await addChild(user.id, name);
  refresh();
}

/** Ходит ли взрослый на занятия сам. Пока не сказал — считаем, что нет. */
export async function setMyAttendance(formData: FormData): Promise<void> {
  if (await onlyLooking()) return;
  const user = await requireUser();
  await setAttends(user.id, String(formData.get('on')) === '1');
  refresh();
}

/**
 * Свою карточку родитель правит сам: раньше её мог поменять только админ.
 * Имя обязательно, ник нет — но если ник написан, он должен быть ником,
 * иначе по нему всё равно никто не напишет.
 *
 * Отвечает результатом, а не переходом на страницу: форма сохраняется сама,
 * и ошибку надо показать прямо под полем, никуда человека не уводя.
 */
export async function updateMyProfile(formData: FormData): Promise<SaveResult> {
  if (await onlyLooking()) return LOOKING;
  const user = await requireUser();
  const name = String(formData.get('name') ?? '').trim().slice(0, 120);
  // Имя обязательно: по нему Варя понимает, кто записывает ребёнка и с
  // кем говорить про деньги. Проверяем первым — оно нужнее ника.
  if (!name) return { ok: false, error: 'Имя и фамилия не могут быть пустыми.' };
  const tg = telegramNick(String(formData.get('telegram') ?? '').slice(0, 80));
  if (!tg.ok) {
    return {
      ok: false,
      error: 'Ник в телеграме — латиница, цифры и подчёркивание, от пяти знаков. Например @my_nick',
    };
  }
  await saveProfile(user.id, name, tg.nick);
  refresh();
  return { ok: true };
}

export async function updateChild(formData: FormData): Promise<SaveResult> {
  if (await onlyLooking()) return LOOKING;
  const user = await requireUser();
  const childId = String(formData.get('childId'));
  const name = String(formData.get('name') ?? '').trim().slice(0, 120);
  // Пустое имя не ошибка, а несохранённая правка: человек стёр и думает.
  if (!name) return { ok: false, error: 'Имя не может быть пустым.' };
  await renameChild(user.id, childId, name);
  refresh();
  return { ok: true };
}

/**
 * Подключение телеграма. Уводит сразу в бота: ссылка одноразовая и живёт
 * четверть часа, показывать её на странице, чтобы человек скопировал
 * руками, незачем.
 */
export async function connectTelegram(): Promise<void> {
  // Из чужого кабинета бот привязался бы к чужому человеку.
  if (await onlyLooking()) return;
  const user = await requireUser();
  const url = await linkUrl(user.id);
  if (!url) redirect('/account/profile?tg=off');
  redirect(url);
}

/** Отключение. Чат забываем, история занятий и оплат этим не трогается. */
export async function disconnectTelegram(): Promise<void> {
  if (await onlyLooking()) return;
  const user = await requireUser();
  await unlinkUser(user.id);
  refresh();
}
