'use server';

import { revalidatePath } from 'next/cache';
import { isAdmin, onlyLooking, requireUser } from '@/lib/session';
import { setLineKind } from '@/lib/expenses';
import { GUESSES } from '@/lib/vision';
import type { SaveResult } from '@/components/AutoSave';

/**
 * Правка группы у строки чека. Деньги это не двигает: расход уже
 * проведён одной суммой, а строки — наша разбивка для отчётов.
 */
export async function setLineKindAction(form: FormData): Promise<SaveResult> {
  if (await onlyLooking()) return { ok: false, error: 'Только смотрите: менять нельзя.' };
  const user = await requireUser();
  if (!isAdmin(user)) return { ok: false, error: 'Расходы ведёт админ.' };

  const lineId = String(form.get('lineId') ?? '');
  const guess = String(form.get('guess') ?? '');
  if (!lineId || !(GUESSES as readonly string[]).includes(guess)) {
    return { ok: false, error: 'Непонятная группа.' };
  }

  await setLineKind(lineId, guess);
  revalidatePath('/admin/studio/costs');
  return { ok: true };
}
