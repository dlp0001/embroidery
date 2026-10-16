'use client';

import { useState } from 'react';

/**
 * То, что нужно изредка, прячем под ссылку: форма, развёрнутая на
 * полэкрана ради одного нажатия в месяц, отнимает место у того, на что
 * смотрят каждый день.
 *
 * Прячем показом, а не удалением: наполовину заполненная форма не
 * пропадает от случайного нажатия по заголовку.
 */
export default function Fold({
  label,
  children,
}: {
  /** Что написано, пока свёрнуто. Развёрнутое всегда «Свернуть». */
  label: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" className="linky" style={{ marginTop: 10 }}
              aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {open ? 'Свернуть' : label}
      </button>
      <div style={{ display: open ? undefined : 'none' }}>{children}</div>
    </>
  );
}
