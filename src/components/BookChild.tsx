'use client';

import { useState, useTransition } from 'react';
import type { SaveResult } from '@/components/AutoSave';
import type { BookableChild } from '@/lib/studio';

/**
 * Запись ребёнка на занятие руками, из расписания.
 *
 * Список детей прячется до нажатия: записывают так изредка, а список
 * длинный, и висеть под каждым занятием ему незачем.
 */
export default function BookChild({
  sessionId,
  children,
  action,
}: {
  sessionId: string;
  children: BookableChild[];
  action: (form: FormData) => Promise<SaveResult>;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function book(form: FormData): void {
    start(async () => {
      const res = await action(form);
      if (res.ok) {
        setError(null);
        setOpen(false);
      } else {
        setError(res.error);
      }
    });
  }

  if (children.length === 0) return null;

  if (!open) {
    return (
      <button type="button" className="linky" onClick={() => setOpen(true)}>
        Записать ребёнка
      </button>
    );
  }

  return (
    <div>
      <form action={book} style={{ display: 'flex', alignItems: 'center',
                                   gap: 12, flexWrap: 'wrap' }}>
        <input type="hidden" name="sessionId" value={sessionId} />
        <select
          name="participantId"
          defaultValue=""
          required
          disabled={pending}
          aria-label="Кого записать"
          style={{ border: 0, borderBottom: '1px solid var(--line)', background: 'transparent',
                   fontFamily: 'inherit', fontSize: 14, padding: '3px 0', outline: 'none',
                   maxWidth: 260 }}
        >
          <option value="" disabled>Кого записать</option>
          {children.map((c) => (
            <option key={c.participant_id} value={c.participant_id}>
              {c.parent ? `${c.name} · ${c.parent}` : c.name}
            </option>
          ))}
        </select>
        <button type="submit" className="linky" disabled={pending}>
          {pending ? 'Записываю…' : 'Записать'}
        </button>
        <button type="button" className="linky" disabled={pending}
                onClick={() => { setError(null); setOpen(false); }}>
          Отмена
        </button>
      </form>
      {error && <p className="err" style={{ margin: '8px 0 0' }}>{error}</p>}
    </div>
  );
}
