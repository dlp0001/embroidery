'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';

/**
 * Ссылка с выпадающим списком. Для того, за чем заглядывают изредка:
 * в ряд такие страницы встают наравне с ежедневными и отнимают у них
 * внимание, а убрать их совсем нельзя — они нужны.
 *
 * Закрывается само: по нажатию мимо, по Escape и после выбора. Меню,
 * которое остаётся висеть, потом закрывают мышью, и это раздражает
 * сильнее, чем лишний клик.
 */
export default function DropMenu({
  label,
  items,
}: {
  label: string;
  items: { href: string; label: string }[];
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent): void => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  return (
    // Тянемся на высоту соседних кнопок: иначе ссылка висит в ряду сама
    // по себе, а список раскрывается из середины строки.
    <div ref={box} style={{ position: 'relative', alignSelf: 'stretch',
                            display: 'flex', alignItems: 'center' }}>
      <button
        type="button"
        className="linky"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((v) => !v)}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
      >
        {label}
        {/* Та же стрелка, что у свёрнутых списков в журнале и в «Людях»:
            одинаковый знак должен значить одно и то же везде.
            inline-block — чтобы подчёркивание ссылки под неё не лезло:
            у строчного потомка его не отменить. */}
        <span aria-hidden style={{ fontSize: 8, display: 'inline-block' }}>
          {open ? '▼' : '▶'}
        </span>
      </button>

      {open && (
        <div
          role="menu"
          style={{
            position: 'absolute', zIndex: 5, top: '100%', left: 0, marginTop: 8,
            minWidth: 180, padding: '6px 0',
            background: 'var(--cream)', border: '1px solid var(--line)',
            boxShadow: '0 8px 24px rgba(26, 26, 46, 0.10)',
          }}
        >
          {items.map((it) => (
            <Link
              key={it.href}
              href={it.href}
              role="menuitem"
              onClick={() => setOpen(false)}
              style={{
                display: 'block', padding: '9px 16px', whiteSpace: 'nowrap',
                fontSize: 12, letterSpacing: '0.04em',
                color: 'var(--charcoal)', textDecoration: 'none',
              }}
            >
              {it.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
