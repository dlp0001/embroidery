'use client';

import { useOptimistic, useTransition } from 'react';

/**
 * Переключатель «да / нет». Отвечает сразу, на сервер уходит фоном:
 * ответа ждать не нужно, а промахнувшись, можно тут же нажать обратно.
 */
export default function YesNo({
  value,
  action,
  fields,
  field = 'on',
  labels = ['Да', 'Нет'],
}: {
  value: boolean;
  action: (form: FormData) => void | Promise<void>;
  /** Постоянные поля запроса, например идентификатор человека. */
  fields?: Record<string, string>;
  field?: string;
  labels?: [string, string];
}) {
  const [, startTransition] = useTransition();
  const [on, setOn] = useOptimistic(value, (_state: boolean, next: boolean) => next);

  function choose(next: boolean) {
    if (next === on) return;
    startTransition(async () => {
      setOn(next);
      const form = new FormData();
      for (const [k, v] of Object.entries(fields ?? {})) form.append(k, v);
      form.append(field, next ? '1' : '0');
      await action(form);
    });
  }

  return (
    <div className="days">
      {[true, false].map((v) => (
        <button
          key={String(v)}
          type="button"
          className={on === v ? 'day-on' : 'day'}
          aria-pressed={on === v}
          onClick={() => choose(v)}
          style={{ minWidth: 0, padding: '0 18px' }}
        >
          {v ? labels[0] : labels[1]}
        </button>
      ))}
    </div>
  );
}
