'use client';

import { useEffect, useRef, useState, useTransition } from 'react';

export type SaveResult = { ok: true } | { ok: false; error: string };

/** Через сколько после последнего нажатия клавиши сохранять само. */
const QUIET_MS = 1500;

/**
 * Форма, которая сохраняется сама.
 *
 * Кнопку «Сохранить» рядом с именем люди просто не жали: правили поле,
 * уходили со страницы и были уверены, что всё записалось. Дни недели
 * на этой же странице давно сохраняются по нажатию, без кнопки, — текст
 * теперь ведёт себя так же.
 *
 * Сохраняем в двух случаях: когда человек ушёл из поля и когда перестал
 * печатать. Второе нужно затем, что со страницы уходят, не щёлкнув мимо
 * поля, и правка иначе пропала бы.
 *
 * Ошибку показываем только после ухода из поля. Пока человек печатает,
 * недописанный ник — ещё не ошибка, и ругаться на него рано.
 */
export default function AutoSave({
  action,
  children,
  hint,
  style,
}: {
  action: (form: FormData) => Promise<SaveResult>;
  children: React.ReactNode;
  /** Что написано под формой, пока сохранять нечего. */
  hint?: string;
  style?: React.CSSProperties;
}) {
  const form = useRef<HTMLFormElement>(null);
  /** Снимок того, что уже лежит в базе: с ним сравниваем, чтобы не слать лишнего. */
  const saved = useRef<string>('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [, startTransition] = useTransition();
  const [state, setState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [error, setError] = useState<string | null>(null);

  function snapshot(): string {
    if (!form.current) return '';
    return [...new FormData(form.current).entries()]
      .map(([k, v]) => `${k}=${String(v)}`).join('&');
  }

  useEffect(() => {
    saved.current = snapshot();
    return () => { if (timer.current) clearTimeout(timer.current); };
    // Снимок снимается один раз, при появлении формы.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function save(quiet: boolean): void {
    if (!form.current) return;
    const now = snapshot();
    if (now === saved.current) return;
    const data = new FormData(form.current);
    startTransition(async () => {
      setState('saving');
      const res = await action(data);
      if (res.ok) {
        saved.current = now;
        setError(null);
        setState('saved');
      } else {
        // Тихое сохранение молчит: человек ещё печатает, ругаться рано.
        setState('idle');
        if (!quiet) setError(res.error);
      }
    });
  }

  return (
    <form
      ref={form}
      // Отправлять форму некуда: сохранение идёт из onBlur и по паузе
      // в наборе. Дни недели на этой странице так же живут без кнопки.
      onSubmit={(e) => e.preventDefault()}
      onInput={() => {
        setState('idle');
        setError(null);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => save(true), QUIET_MS);
      }}
      onBlur={() => {
        if (timer.current) clearTimeout(timer.current);
        save(false);
      }}
      onKeyDown={(e) => {
        // Enter в поле привычно означает «записал», а не «отправь форму».
        if (e.key === 'Enter') {
          e.preventDefault();
          (e.target as HTMLElement).blur();
        }
      }}
    >
      {/* Поля лежат в своей обёртке: подпись о сохранении должна быть под
          ними, а не встать рядом, если поля выложены в строку. */}
      <div style={style}>{children}</div>
      <p className={error ? 'err' : 'hint'} style={{ margin: '10px 0 0' }} aria-live="polite">
        {error ?? (state === 'saving' ? 'Сохраняем…' : state === 'saved' ? 'Сохранено' : hint ?? '')}
      </p>
    </form>
  );
}
