'use client';

import { useRef } from 'react';
import type { CabinetOwner } from '@/lib/studio';

/**
 * Переключатель кабинетов в полосе просмотра. Выбрал человека — тут же
 * открылся его кабинет, без лишней кнопки: отдельное «Показать» рядом
 * с выбором ничего не добавляет, кроме второго щелчка.
 */
export default function PeekSwitch({
  action,
  people,
  current,
}: {
  action: (form: FormData) => void;
  people: CabinetOwner[];
  current: string;
}) {
  const form = useRef<HTMLFormElement>(null);
  const studio = people.filter((p) => p.teaches);
  const parents = people.filter((p) => !p.teaches);
  const name = (p: CabinetOwner) => p.name ?? p.email;

  return (
    <form action={action} ref={form} style={{ display: 'inline' }}>
      <select
        name="userId"
        defaultValue={current}
        aria-label="Чей кабинет смотреть"
        onChange={() => form.current?.requestSubmit()}
        style={{
          background: 'transparent', border: 0, borderBottom: '1px dotted var(--warm-gray)',
          padding: '0 2px 1px', font: 'inherit', color: 'var(--charcoal)',
          maxWidth: 190, cursor: 'pointer',
        }}
      >
        {studio.length > 0 && (
          <optgroup label="Студия">
            {studio.map((p) => <option key={p.id} value={p.id}>{name(p)}</option>)}
          </optgroup>
        )}
        <optgroup label="Родители">
          {parents.map((p) => <option key={p.id} value={p.id}>{name(p)}</option>)}
        </optgroup>
      </select>
      {/* Без скриптов выбор сам не отправится: оставляем кнопку. */}
      <noscript>
        <button className="linky" type="submit" style={{ marginLeft: 8 }}>Открыть</button>
      </noscript>
    </form>
  );
}
