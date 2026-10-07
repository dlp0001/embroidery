'use client';

import { useState } from 'react';

/**
 * Раздел, который можно свернуть. Заголовок — обычная надпись, но вся
 * строка нажимается: абонементов на «Финансах» полтора десятка, и ради
 * общей суммы долга пролистывать их все незачем.
 *
 * Число в заголовке видно и свёрнутым: чаще всего нужно именно оно, а не
 * список. Прячем показом, а не удалением: внутри живут формы продления,
 * и наполовину заполненная не должна пропадать от нажатия на заголовок.
 */
export default function Section({
  title,
  count,
  open = false,
  children,
}: {
  title: string;
  /** Сколько внутри: подписывается к заголовку. */
  count?: number;
  /** Развернуть сразу. */
  open?: boolean;
  children: React.ReactNode;
}) {
  const [on, setOn] = useState(open);

  return (
    <>
      <button
        type="button"
        className="lbl"
        aria-expanded={on}
        onClick={() => setOn((v) => !v)}
        style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                 background: 'none', border: 0, padding: 0, cursor: 'pointer',
                 fontFamily: 'inherit', textAlign: 'left' }}
      >
        <span aria-hidden style={{ fontSize: 8 }}>{on ? '▼' : '▶'}</span>
        {title}{count === undefined ? '' : ` · ${count}`}
      </button>
      <div style={{ display: on ? undefined : 'none' }}>{children}</div>
    </>
  );
}
