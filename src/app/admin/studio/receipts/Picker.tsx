'use client';

import { useState } from 'react';
import { useFormStatus } from 'react-dom';
import { plural } from '@/lib/format';

/**
 * Строка списка — занятие, а не платёж. Так его и ищут глазами: «за
 * какое занятие нет чека». Но квитанция выписывается на платёж целиком,
 * поэтому у строк одного платежа общий `pay`: отметили одну — поднялись
 * все, и в iCount уйдёт одна бумага.
 */
export type Row = {
  /** Платёж, на который выпишется квитанция. */
  pay: string;
  who: string;
  /** «1 сентября · Отто» или «абонемент на 8 занятий». */
  label: string;
  sum: string;
  how: string;
  /** Про этот платёж говорили «чек не нужен». */
  declined: boolean;
  /** В этом платеже не одно занятие: чек будет общий. */
  shared: boolean;
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
 * Выбор занятий, по которым надо выписать бумагу. Сгруппированы по
 * плательщику: квитанция выписывается на него, и смотреть список удобнее
 * так же.
 *
 * По умолчанию не отмечено ничего. Это не осторожность ради осторожности:
 * квитанция уходит в бухгалтерию и отменяется только руками в iCount,
 * поэтому выбрать нужное должен человек, а не страница за него.
 */
export default function Picker({ rows }: { rows: Row[] }) {
  const [picked, setPicked] = useState<Set<string>>(new Set());

  function toggle(pay: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(pay)) next.delete(pay);
      else next.add(pay);
      return next;
    });
  }

  // Плательщик → его занятия: имя пишется один раз на всех.
  const byWho = new Map<string, Row[]>();
  for (const r of rows) byWho.set(r.who, [...(byWho.get(r.who) ?? []), r]);

  const lessons = rows.filter((r) => picked.has(r.pay)).length;

  return (
    <>
      <div className="row" style={{ marginBottom: 6 }}>
        <p className="hint" style={{ margin: 0 }}>
          Отмечено {lessons} из {rows.length}
        </p>
        {picked.size > 0 && (
          <button type="button" className="chip-money money"
                  onClick={() => setPicked(new Set())}>
            снять все
          </button>
        )}
      </div>

      {/* Поля формы — по платежам, а не по строкам: две строки одного
          платежа не должны просить две квитанции. */}
      {[...picked].map((pay) => (
        <input key={pay} type="hidden" name="pay" value={pay} />
      ))}

      {[...byWho.entries()].map(([who, list]) => (
        <div key={who}>
          <div className="when visit-day">{who}</div>
          {list.map((r, i) => {
            const on = picked.has(r.pay);
            return (
              <button type="button" className="visit debt" key={`${r.pay}-${i}`}
                      onClick={() => toggle(r.pay)} aria-pressed={on}
                      aria-label={`${who}, ${r.label}, ${r.sum}: ${
                        on ? 'не выписывать' : 'выписать чек'}`}>
                <span className={on ? 'box box-sm box-on' : 'box box-sm'}>
                  {on && (
                    <svg viewBox="0 0 24 24"><path d="M4 12.5 L9.5 18 L20 6" /></svg>
                  )}
                </span>
                <span className="visit-who" style={{ opacity: on ? 1 : 0.55 }}>{r.label}</span>
                <span className="visit-sum" style={{ opacity: on ? 1 : 0.55 }}>{r.sum}</span>
                <span className="visit-how">
                  {r.how}
                  {r.shared ? ' · общий чек' : ''}
                  {r.declined ? ' · просили без чека' : ''}
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
        Квитанция выписывается на платёж целиком: занятия, оплаченные
        вместе, помечены «общий чек» и отмечаются разом. Бумага уходит на
        почту плательщика и в бухгалтерию, а отменяется только в iCount —
        и там это отдельная, обратная квитанция.
      </p>
    </>
  );
}
