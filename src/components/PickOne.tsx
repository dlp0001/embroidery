'use client';

import { useOptimistic, useTransition } from 'react';

/**
 * Выбор одного из нескольких: ряд кнопок, где нажатая отменяет прежнюю.
 *
 * От Toggles отличается тем, что выбрать можно ровно одно. Так ведёт
 * себя метка «чеки на меня»: держать её может только один человек в
 * семье, иначе непонятно, чьё имя идёт в отчётность.
 */
export default function PickOne({
  items,
  value,
  action,
  fields,
  field = 'targetId',
  label,
}: {
  items: { id: string; label: string }[];
  value: string;
  action: (form: FormData) => void | Promise<void>;
  /** Постоянные поля запроса, например семья, в которой выбираем. */
  fields?: Record<string, string>;
  field?: string;
  /** Подпись ряда для тех, кто слушает экран. */
  label?: string;
}) {
  const [pending, start] = useTransition();
  const [on, setOn] = useOptimistic(value, (_state: string, next: string) => next);

  function choose(id: string): void {
    if (id === on) return;
    start(async () => {
      setOn(id);
      const form = new FormData();
      for (const [k, v] of Object.entries(fields ?? {})) form.append(k, v);
      form.append(field, id);
      await action(form);
    });
  }

  return (
    <div className="days" role="group" aria-label={label}>
      {items.map((it) => (
        <button
          key={it.id}
          type="button"
          className={on === it.id ? 'day-on' : 'day'}
          aria-pressed={on === it.id}
          disabled={pending}
          onClick={() => choose(it.id)}
          style={{ minWidth: 0, padding: '0 18px' }}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}
