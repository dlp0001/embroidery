'use client';

import { useState, useTransition } from 'react';
import type { SaveResult } from '@/components/AutoSave';
import { dayAtTime } from '@/lib/format';
import type { BookedChild } from '@/lib/studio';

/** «записала Евгения Кочнова из кабинета, 23 сентября в 08:19». */
const WHERE: Record<string, string> = {
  cabinet: 'из кабинета', journal: 'из расписания', bot: 'в боте',
};

function trace(b: BookedChild): string {
  const what = b.status === 'booked' ? 'записал' : 'снял';
  const who = b.changed_by ? `${what}(а) ${b.changed_by}` : what + '(а) неизвестно кто';
  const where = b.changed_via ? ` ${WHERE[b.changed_via] ?? ''}` : '';
  return `${who}${where}, ${dayAtTime(b.changed_at)}`;
}

/**
 * Кто записан на занятие. Имена — ссылки: нажатие снимает запись, но
 * сначала спрашивает.
 *
 * Спрашиваем своим вопросом на странице, а не окном браузера: окно
 * выглядит чужим, его закрывают не читая, а снятая запись значит, что
 * ребёнка перестанут ждать.
 */
export default function BookedList({
  sessionId,
  booked,
  action,
}: {
  sessionId: string;
  booked: BookedChild[];
  action: (form: FormData) => Promise<SaveResult>;
}) {
  const [asking, setAsking] = useState<BookedChild | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (booked.length === 0) return null;

  function drop(who: BookedChild): void {
    const form = new FormData();
    form.append('sessionId', sessionId);
    form.append('participantId', who.participant_id);
    start(async () => {
      const res = await action(form);
      if (res.ok) {
        setError(null);
        setAsking(null);
      } else {
        setError(res.error);
      }
    });
  }

  if (asking) {
    return (
      <div className="sub" style={{ display: 'flex', alignItems: 'baseline',
                                    gap: 12, flexWrap: 'wrap', marginTop: 6 }}>
        <span>Снять запись: {asking.who}?</span>
        <button type="button" className="linky" disabled={pending}
                onClick={() => drop(asking)}>
          {pending ? 'Снимаю…' : 'Да, снять'}
        </button>
        <button type="button" className="linky" disabled={pending}
                onClick={() => { setError(null); setAsking(null); }}>
          Нет
        </button>
        {error && <span className="err">{error}</span>}
      </div>
    );
  }

  return (
    <div className="sub" style={{ display: 'flex', alignItems: 'baseline',
                                  gap: 12, flexWrap: 'wrap', marginTop: 6 }}>
      {booked.map((b) => (
        <button key={b.participant_id} type="button" className="linky linky-soft"
                title={trace(b)} onClick={() => setAsking(b)}>
          {b.who}
        </button>
      ))}
    </div>
  );
}
