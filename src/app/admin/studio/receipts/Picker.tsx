'use client';

import { useState } from 'react';
import { useFormStatus } from 'react-dom';
import { plural } from '@/lib/format';

export type Row = {
  id: string;
  who: string;
  at: string;
  what: string;
  how: string;
  sum: string;
  /** Про этот платёж говорили «чек не нужен». */
  declined: boolean;
};

/**
 * Сколько квитанций уходит за одно нажатие. Ограничение не про вкус:
 * iCount отвечает по секунде-две, а в плохой день по двенадцать, и у
 * страницы есть только минута.
 */
const AT_ONCE = 10;

/** Кнопка знает, что отправка идёт: iCount отвечает не мгновенно. */
function Submit({ n }: { n: number }) {
  const { pending } = useFormStatus();
  return (
    <button className="btn" type="submit" disabled={pending || n === 0 || n > AT_ONCE}>
      {pending
        ? 'Выписываем…'
        : n === 0
          ? 'Ничего не выбрано'
          : `Выписать ${n} ${plural(n, 'чек', 'чека', 'чеков')}`}
    </button>
  );
}

/**
 * Выбор платежей, по которым надо выписать бумагу. Сгруппированы по
 * плательщику: квитанция выписывается на него, и смотреть на список
 * удобнее так же.
 *
 * По умолчанию не отмечено ничего. Это не осторожность ради осторожности:
 * квитанция уходит в бухгалтерию и отменяется только руками в iCount,
 * поэтому выбрать нужное должен человек, а не страница за него.
 */
export default function Picker({ rows }: { rows: Row[] }) {
  const [picked, setPicked] = useState<Set<string>>(new Set());

  function toggle(id: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Плательщик → его платежи: имя пишется один раз на всех.
  const byWho = new Map<string, Row[]>();
  for (const r of rows) byWho.set(r.who, [...(byWho.get(r.who) ?? []), r]);

  return (
    <>
      <div className="row" style={{ marginBottom: 6 }}>
        <p className="hint" style={{ margin: 0 }}>
          Отмечено {picked.size} из {rows.length}
        </p>
        {picked.size > 0 && (
          <button type="button" className="chip-money money"
                  onClick={() => setPicked(new Set())}>
            снять все
          </button>
        )}
      </div>

      {[...byWho.entries()].map(([who, list]) => (
        <div key={who}>
          <div className="when visit-day">{who}</div>
          {list.map((r) => {
            const on = picked.has(r.id);
            return (
              <button type="button" className="visit debt" key={r.id}
                      onClick={() => toggle(r.id)} aria-pressed={on}
                      aria-label={`${who}, ${r.sum} ${r.at}: ${
                        on ? 'не выписывать' : 'выписать чек'}`}>
                {on && <input type="hidden" name="pay" value={r.id} />}
                <span className={on ? 'box box-sm box-on' : 'box box-sm'}>
                  {on && (
                    <svg viewBox="0 0 24 24"><path d="M4 12.5 L9.5 18 L20 6" /></svg>
                  )}
                </span>
                <span className="visit-who" style={{ opacity: on ? 1 : 0.55 }}>
                  {r.at} · {r.what}
                </span>
                <span className="visit-sum" style={{ opacity: on ? 1 : 0.55 }}>{r.sum}</span>
                <span className="visit-how">
                  {r.how}{r.declined ? ' · просили без чека' : ''}
                </span>
              </button>
            );
          })}
        </div>
      ))}

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap',
                    padding: '18px 2px 0', borderTop: '1px solid var(--line)',
                    marginTop: 12 }}>
        <Submit n={picked.size} />
        {picked.size > AT_ONCE && (
          <span className="hint" style={{ color: 'var(--rose-dark)' }}>
            За раз — не больше {AT_ONCE}: iCount отвечает не мгновенно, и
            страница не дождётся. Снимите лишние и повторите.
          </span>
        )}
      </div>

      <p className="hint" style={{ marginTop: 14 }}>
        Квитанция уходит на почту плательщика и в бухгалтерию. Отменить её
        можно только в iCount, и там это отдельная бумага — обратная.
      </p>
    </>
  );
}
