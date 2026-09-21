'use server';

import { revalidatePath } from 'next/cache';
import { confirmCash, declineCash } from '@/lib/billing';
import { isAdmin, requireUser } from '@/lib/session';
import {
  addSession, cancelLessonsDuring, createGroup, issuePass, resyncGroupSessions, saleOffers,
  setGroupActive, setSessionStatus, updateGroup,
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
  const input = readGroup(form);
  const id = await createGroup(input);
  // Сразу расставляем занятия, иначе новая группа висит без расписания.
  await resyncGroupSessions(id);
  if (input.kind !== 'lesson') await cancelLessonsDuring(id);
  refresh();
}

export async function updateGroupAction(form: FormData): Promise<void> {
  await requireAdmin();
  const id = String(form.get('id'));
  const input = readGroup(form);
  await updateGroup(id, input);
  // День или время могли измениться — переносим будущие пустые занятия.
  await resyncGroupSessions(id);
  if (input.kind !== 'lesson') await cancelLessonsDuring(id);
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
