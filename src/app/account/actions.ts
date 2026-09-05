'use server';

import { revalidatePath } from 'next/cache';
import { one } from '@/lib/db';
import { requireUser } from '@/lib/session';
import { setBooking } from '@/lib/studio';

/** Записать или снять запись. Проверяем, что участник действительно из семьи. */
export async function toggleBooking(formData: FormData): Promise<void> {
  const user = await requireUser();
  const sessionId = String(formData.get('sessionId'));
  const participantId = String(formData.get('participantId'));
  const booked = String(formData.get('booked')) === '1';

  const allowed = await one(
    `select 1 from participants p
      where p.id = $1
        and (p.user_id = $2 or p.child_id in (select child_id from guardians where user_id = $2))`,
    [participantId, user.id],
  );
  if (!allowed) throw new Error('FORBIDDEN');

  await setBooking(sessionId, participantId, booked);
  revalidatePath('/account');
  revalidatePath('/account/calendar');
}
