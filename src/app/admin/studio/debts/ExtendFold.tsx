'use client';

import { useState } from 'react';

/**
 * Продление прячем под ссылку. Абонементов на экране полтора десятка, и
 * развёрнутая форма у каждого превращала список в анкету: три поля и
 * кнопка на карточку, а нужны они изредка и одному.
 *
 * Прячем показом, а не удалением: наполовину заполненная форма не
 * пропадает от случайного нажатия.
 */
export default function ExtendFold({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" className="linky" style={{ marginTop: 10 }}
              aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {open ? 'Свернуть' : 'Продлить'}
      </button>
      <div style={{ display: open ? undefined : 'none' }}>{children}</div>
    </>
  );
}
