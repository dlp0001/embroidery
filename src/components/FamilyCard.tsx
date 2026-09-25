'use client';

import { useState } from 'react';
import { plural } from '@/lib/format';

/**
 * Семья в списке: свёрнутая — имя родителя и имена детей, развёрнутая —
 * всё остальное. Семей три десятка, и раскрытыми они занимают несколько
 * экранов: чтобы найти нужную, приходилось листать мимо чужих полей.
 *
 * Развёрнутое прячем показом, а не удалением: формы внутри остаются
 * живыми, и наполовину заполненное поле не пропадает от нажатия.
 */
export default function FamilyCard({
  name,
  kids,
  hidden,
  children,
}: {
  name: string;
  kids: string[];
  hidden: number;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="card">
      <button type="button" className="fold" aria-expanded={open}
              onClick={() => setOpen((v) => !v)}>
        <span aria-hidden style={{ fontSize: 8, paddingTop: 8 }}>{open ? '▼' : '▶'}</span>
        <span style={{ minWidth: 0 }}>
          <span className="what" style={{ display: 'block' }}>{name}</span>
          {/* Раскрытая карточка перечисляет детей подробно, и строка
              с именами в шапке только повторялась бы. */}
          {!open && (
            <span className="sub" style={{ display: 'block' }}>
              {kids.length > 0 ? kids.join(', ') : 'детей нет'}
              {hidden > 0 && `, ещё ${hidden} ${plural(hidden, 'скрытый', 'скрытых', 'скрытых')}`}
            </span>
          )}
        </span>
      </button>

      <div style={{ display: open ? undefined : 'none', marginTop: 14 }}>{children}</div>
    </div>
  );
}
