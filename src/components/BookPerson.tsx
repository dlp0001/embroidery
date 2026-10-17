'use client';

import { useState, useTransition } from 'react';
import type { SaveResult } from '@/components/AutoSave';

/** Кого предлагаем записать: ребёнка с родителем или взрослого. */
export type Bookable = {
  participant_id: string;
  name: string;
  /** Чем различать тёзок: чей ребёнок, ходит ли взрослый обычно. */
  note?: string | null;
};

/**
 * Запись на занятие руками, из расписания. Одна и та же форма для детей
 * и для взрослых: разница только в слове на ссылке и в том, кого дают
 * выбрать, а запись устроена одинаково — она на участника.
 *
 * Список прячется до нажатия: записывают так изредка, а список длинный,
 * и висеть под каждым занятием ему незачем.
 */
export default function BookPerson({
  sessionId,
  people,
  action,
  label,
}: {
  sessionId: string;
  people: Bookable[];
  action: (form: FormData) => Promise<SaveResult>;
  /** «Записать ребёнка» или «Записать взрослого». */
  label: string;
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

  if (people.length === 0) return null;

  if (!open) {
    return (
      <button type="button" className="linky" onClick={() => setOpen(true)}>
        {label}
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
          {people.map((p) => (
            <option key={p.participant_id} value={p.participant_id}>
              {p.note ? `${p.name} · ${p.note}` : p.name}
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
