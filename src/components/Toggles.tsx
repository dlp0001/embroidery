'use client';

import { useOptimistic, useTransition } from 'react';

export type ToggleItem = { id: string; label: string };

/**
 * Ряд переключателей, которые можно нажимать подряд.
 *
 * Раньше каждый был отдельной формой с перезагрузкой страницы, и
 * нажатия друг за другом терялись: пока страница обновлялась, следующий
 * клик уходил в никуда. Теперь состояние меняется сразу, а обращения к
 * серверу идут фоном.
 */
export default function Toggles({
  items,
  active,
  action,
  fields,
  itemField,
  size = 'day',
}: {
  items: ToggleItem[];
  active: string[];
  action: (form: FormData) => void | Promise<void>;
  /** Постоянные поля запроса, например идентификатор участника. */
  fields: Record<string, string>;
  /** Имя поля, в которое кладётся идентификатор переключателя. */
  itemField: string;
  size?: 'day' | 'wide';
}) {
  const [, startTransition] = useTransition();
  const [on, setOn] = useOptimistic(
    new Set(active),
    (state: Set<string>, id: string) => {
      const next = new Set(state);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    },
  );

  function toggle(id: string) {
    const willBeOn = !on.has(id);
    startTransition(async () => {
      setOn(id);
      const form = new FormData();
      for (const [k, v] of Object.entries(fields)) form.append(k, v);
      form.append(itemField, id);
      form.append('on', willBeOn ? '1' : '0');
      form.append('member', willBeOn ? '1' : '0');
      await action(form);
    });
  }

  return (
    <div className="days">
      {items.map((it) => {
        const isOn = on.has(it.id);
        return (
          <button
            key={it.id}
            type="button"
            className={isOn ? 'day-on' : 'day'}
            aria-pressed={isOn}
            onClick={() => toggle(it.id)}
            style={size === 'wide' ? { minWidth: 0, padding: '0 12px' } : undefined}
          >
            {it.label}
          </button>
        );
      })}
    </div>
  );
}
