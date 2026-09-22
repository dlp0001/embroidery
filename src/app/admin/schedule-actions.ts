'use server';

import { revalidatePath } from 'next/cache';
import { confirmCash, declineCash } from '@/lib/billing';
import type { SaveResult } from '@/components/AutoSave';
import { isAdmin, requireUser } from '@/lib/session';
import {
  addSession, createGroup, issuePass, resyncGroupSessions, saleOffers,
  setBooking, setGroupActive, setSessionStatus, setSessionTime, updateGroup,
  type GroupInput, type GroupKind, type PassOffer,
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

const KINDS: GroupKind[] = ['lesson', 'camp', 'event'];

/**
 * Пакеты записываются одной строкой: «5 — 1550, 6 — 1800». Читаем из
 * каждого куска два числа: сколько дней и сколько стоит.
 */
function readOffers(raw: string): PassOffer[] {
  const offers: PassOffer[] = [];
  for (const chunk of raw.split(',')) {
    const nums = chunk.match(/\d+/g);
    if (!nums || nums.length < 2) continue;
    const lessons = Number(nums[0]);
    const price = Number(nums[1]);
    if (lessons > 0 && lessons <= 60 && price >= 0) offers.push({ lessons, price });
  }
  return offers.sort((a, b) => a.lessons - b.lessons);
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
  const date = (key: string) => {
    const raw = String(form.get(key) ?? '').trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
  };

  const kindRaw = String(form.get('kind') ?? 'lesson') as GroupKind;
  const kind = KINDS.includes(kindRaw) ? kindRaw : 'lesson';
  const weekly = kind === 'lesson';
  const weekday = num('weekday');
  const audience = String(form.get('audience') ?? 'kids');
  if (weekly && (!weekday || weekday < 1 || weekday > 7)) throw new Error('BAD_WEEKDAY');
  if (audience !== 'kids' && audience !== 'adults') throw new Error('BAD_AUDIENCE');

  const title = text('title');
  if (!title) throw new Error('BAD_TITLE');

  const startsOn = date('startsOn');
  const endsOn = date('endsOn');
  if (!weekly) {
    if (!startsOn || !endsOn) throw new Error('BAD_PERIOD');
    if (endsOn < startsOn) throw new Error('BAD_PERIOD');
  }

  const offers = weekly ? null : readOffers(String(form.get('passOffers') ?? ''));

  return {
    title,
    weekday: weekly ? weekday : null,
    startsAt: String(form.get('startsAt') ?? '').slice(0, 5) || '16:00',
    durationMin: num('durationMin') ?? 90,
    audience,
    ageHint: text('ageHint'),
    capacity: num('capacity'),
    room: text('room'),
    teacherId: text('teacherId'),
    kind,
    price: weekly ? null : num('price'),
    passOffers: offers && offers.length > 0 ? offers : null,
    startsOn: weekly ? null : startsOn,
    endsOn: weekly ? null : endsOn,
    weekdays: weekly
      ? []
      : form.getAll('weekdays').map(Number).filter((n) => n >= 1 && n <= 7),
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
  // Отказ возможен только у прошедшего занятия с отметками: кнопки для
  // него на экране нет, так что сюда доходят разве что старой вкладкой.
  const done = await setSessionStatus(String(form.get('id')), status);
  if (!done) throw new Error('PAST_WITH_ATTENDANCE');
  refresh();
}

/**
 * Перенос одного занятия на другое время. Пустое поле возвращает занятию
 * обычное время группы.
 */
export async function setSessionTimeAction(form: FormData): Promise<void> {
  await requireAdmin();
  const usual = String(form.get('usual') ?? '') === '1';
  // Набирают по-разному: «9:00», «09:00», «0900». Приводим к одному виду,
  // прежде чем проверять, — отказывать из-за пропущенного нуля незачем.
  const digits = String(form.get('startsAt') ?? '').replace(/\D/g, '');
  const time = digits.length === 3 || digits.length === 4
    ? `${digits.slice(0, -2).padStart(2, '0')}:${digits.slice(-2)}`
    : '';
  if (!usual && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error('BAD_TIME');
  await setSessionTime(String(form.get('id')), usual ? null : time);
  refresh();
}


/**
 * Запись ребёнка на занятие руками. Родители отмечаются сами, в кабинете,
 * но договариваются и голосом — тогда записывает Варя.
 *
 * Отвечает результатом, а не переходом: «мест нет» надо сказать прямо
 * в том месте, где выбирали ребёнка.
 */
export async function bookChildAction(form: FormData): Promise<SaveResult> {
  await requireAdmin();
  const sessionId = String(form.get('sessionId') ?? '');
  const participantId = String(form.get('participantId') ?? '');
  if (!sessionId || !participantId) return { ok: false, error: 'Выберите ребёнка.' };
  const res = await setBooking(sessionId, participantId, true);
  if (!res.ok) return { ok: false, error: res.reason ?? 'Записать не вышло.' };
  refresh();
  return { ok: true };
}

export async function issuePassAction(form: FormData): Promise<void> {
  const user = await requireAdmin();
  // Форма присылает один ключ вида «id группы:дней»: так пакет лагеря
  // не перепутать со студийным абонементом на то же число занятий.
  const [groupKey, lessonsKey] = String(form.get('offer') ?? '').split(':');
  const lessons = Number(lessonsKey);
  const paid = String(form.get('paid'));
  const offer = (await saleOffers()).find(
    (o) => (o.groupId ?? '') === groupKey && o.lessons === lessons,
  );
  if (!offer) throw new Error('BAD_LESSONS');
  if (paid !== 'cash' && paid !== 'transfer' && paid !== 'unpaid') throw new Error('BAD_PAID');

  await issuePass(
    {
      ownerId: String(form.get('ownerId')),
      lessons: offer.lessons,
      months: offer.months,
      paid,
      coverDebt: form.get('coverDebt') === 'on',
      groupId: offer.groupId,
      price: offer.price,
      validTo: offer.validTo,
    },
    user.id,
  );
  revalidatePath('/admin/studio/debts');
  revalidatePath('/admin/studio');
  revalidatePath('/account');
  revalidatePath('/account/pay');
}

const HOW = ['cash', 'bit', 'paybox'] as const;

export async function confirmCashAction(form: FormData): Promise<void> {
  const user = await requireAdmin();
  const raw = String(form.get('payMethod') ?? 'cash');
  const method = (HOW as readonly string[]).includes(raw)
    ? (raw as (typeof HOW)[number])
    : 'cash';
  await confirmCash(String(form.get('paymentId')), user.id, {
    method,
    receipt: form.get('receipt') === 'on',
  });
  revalidatePath('/admin/studio/debts');
  revalidatePath('/admin/studio/ledger');
  revalidatePath('/account/pay');
}

export async function declineCashAction(form: FormData): Promise<void> {
  const user = await requireAdmin();
  await declineCash(String(form.get('paymentId')), user.id);
  revalidatePath('/admin/studio/debts');
  revalidatePath('/admin/studio/ledger');
  revalidatePath('/account/pay');
}
