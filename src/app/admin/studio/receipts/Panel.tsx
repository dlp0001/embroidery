'use client';

import { useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useFormStatus } from 'react-dom';
import { money, plural } from '@/lib/format';

/**
 * Строка списка — занятие, а не платёж. Так его и ищут глазами: «за какое
 * занятие нет чека». Но квитанция выписывается на платёж целиком, поэтому
 * у строк одного платежа общий `pay`: отметили одну — поднялись все, и в
 * iCount уйдёт одна бумага.
 */
export type Row = {
  /** Платёж, на который выпишется квитанция. */
  pay: string;
  who: string;
  /** «1 сентября · Отто» или «абонемент на 8 занятий». */
  label: string;
  amount: number;
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

const NUM: React.CSSProperties = {
  fontFamily: "'Cormorant Garamond', serif", fontSize: 22, lineHeight: 1.1,
};
const TAG: React.CSSProperties = {
  fontSize: 10, letterSpacing: '0.2em', textTransform: 'uppercase',
  color: 'var(--warm-gray)',
};
/** Подпись над числом: в строку они слипаются, а места это почти не стоит. */
const PAIR: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 2 };

/**
 * Шапка страницы и, когда её попросили, список занятий без квитанций.
 *
 * Шапка липкая: выбирая занятия в длинном списке, нужно видеть, за какие
 * дни смотрим, сколько бумаг не выписано и на сколько уже наотмечал. Ради
 * этого же фильтр и свёрнутая таблица живут здесь, а не выше по странице:
 * прилипнуть может только то, что лежит одним куском.
 *
 * Таблица приходит готовой со страницы: считать её на клиенте незачем, а
 * показывать по требованию — да, чаще всего хватает двух чисел.
 */
export default function Panel({
  from,
  to,
  billed,
  left,
  currency,
  rows,
  action,
  children,
}: {
  from: string;
  to: string;
  billed: number;
  left: number;
  currency: string;
  /** Занятия без квитанций. Пусто — страница открыта просто посмотреть. */
  rows?: Row[];
  action?: (form: FormData) => void | Promise<void>;
  /** Таблица «как оплачено»: показывается развёрнутой. */
  children: ReactNode;
}) {
  const router = useRouter();
  const [a, setA] = useState(from);
  const [b, setB] = useState(to);
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const list = rows ?? [];
  const mine = list.filter((r) => picked.has(r.pay));
  const chosen = mine.reduce((s, r) => s + r.amount, 0);

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
  for (const r of list) byWho.set(r.who, [...(byWho.get(r.who) ?? []), r]);

  return (
    <>
      <div style={{ position: 'sticky', top: 0, zIndex: 3, background: 'var(--cream)',
                    borderBottom: '1px solid var(--line)', marginBottom: 14 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap',
                      padding: '8px 0' }}>
          <input type="date" value={a} onChange={(e) => setA(e.target.value)}
                 aria-label="С какого дня" style={{ padding: '5px 8px', fontSize: 14,
                 border: '1px solid var(--line)', background: 'transparent' }} />
          <span className="hint">—</span>
          <input type="date" value={b} onChange={(e) => setB(e.target.value)}
                 aria-label="По какой день" style={{ padding: '5px 8px', fontSize: 14,
                 border: '1px solid var(--line)', background: 'transparent' }} />
          <button type="button" className="chip chip-sm"
                  onClick={() => router.push(
                    `/admin/studio/receipts?from=${a}&to=${b}${rows ? '&issue=1' : ''}`)}>
            Показать
          </button>
        </div>

        {/* Два числа — то, ради чего сюда заходят. Таблица под ними и
            по требованию: подробности нужны реже, чем итог. */}
        <button type="button" className="fold" aria-expanded={open}
                onClick={() => setOpen((v) => !v)}
                style={{ alignItems: 'center', gap: 14, flexWrap: 'wrap',
                         padding: '8px 0 10px' }}>
          <span aria-hidden style={{ fontSize: 8, color: 'var(--warm-gray)' }}>
            {open ? '▼' : '▶'}
          </span>
          <span style={PAIR}>
            <span style={TAG}>Выписано</span>
            <span style={NUM}>{money(billed, currency)}</span>
          </span>
          <span style={PAIR}>
            <span style={TAG}>Не выписано</span>
            <span style={{ ...NUM, color: left > 0 ? 'var(--rose-dark)' : undefined }}>
              {money(left, currency)}
            </span>
          </span>
          {/* Чем станет «выписано», если нажать кнопку. Появляется только
              когда есть что считать: пустой столбец про будущее — шум. */}
          {chosen > 0 && (
            <span style={PAIR}>
              <span style={TAG}>Будет выписано</span>
              <span style={{ ...NUM, color: 'var(--ok)' }}>
                {money(billed + chosen, currency)}
              </span>
            </span>
          )}
        </button>

        <div style={{ display: open ? undefined : 'none', paddingBottom: 12 }}>{children}</div>

        {mine.length > 0 && (
          <div className="hint" style={{ padding: '8px 0 10px',
                                         borderTop: '1px solid var(--line-soft)' }}>
            Отмечено {mine.length}&nbsp;{plural(mine.length, 'занятие', 'занятия', 'занятий')} на{' '}
            <b style={{ fontWeight: 400, color: 'var(--charcoal)' }}>{money(chosen, currency)}</b>
            {' '}— выпишется {picked.size}&nbsp;{plural(picked.size, 'чек', 'чека', 'чеков')}
          </div>
        )}
      </div>

      {rows && action && (
        <form action={action}>
          <input type="hidden" name="from" value={from} />
          <input type="hidden" name="to" value={to} />
          {/* Поля формы — по платежам, а не по строкам: две строки одного
              платежа не должны просить две квитанции. */}
          {[...picked].map((pay) => (
            <input key={pay} type="hidden" name="pay" value={pay} />
          ))}

          {/* Сколько отмечено, говорит липкая шапка: тут осталось только
              общее число и способ снять всё разом. */}
          <div className="row" style={{ marginBottom: 6 }}>
            <p className="hint" style={{ margin: 0 }}>
              Занятий без квитанции: {rows.length}
            </p>
            {picked.size > 0 && (
              <button type="button" className="chip-money money"
                      onClick={() => setPicked(new Set())}>
                снять все
              </button>
            )}
          </div>

          {[...byWho.entries()].map(([who, group]) => (
            <div key={who}>
              <div className="when visit-day">{who}</div>
              {group.map((r, i) => {
                const on = picked.has(r.pay);
                return (
                  <button type="button" className="visit debt" key={`${r.pay}-${i}`}
                          onClick={() => toggle(r.pay)} aria-pressed={on}
                          aria-label={`${who}, ${r.label}, ${money(r.amount, currency)}: ${
                            on ? 'не выписывать' : 'выписать чек'}`}>
                    <span className={on ? 'box box-sm box-on' : 'box box-sm'}>
                      {on && (
                        <svg viewBox="0 0 24 24"><path d="M4 12.5 L9.5 18 L20 6" /></svg>
                      )}
                    </span>
                    <span className="visit-who" style={{ opacity: on ? 1 : 0.55 }}>{r.label}</span>
                    <span className="visit-sum" style={{ opacity: on ? 1 : 0.55 }}>
                      {money(r.amount, currency)}
                    </span>
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
        </form>
      )}
    </>
  );
}
