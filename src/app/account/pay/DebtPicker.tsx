'use client';

import { useState } from 'react';
import { declareCashAction, declareTransferAction, payDebtAction } from './actions';
import type { UnpaidCharge } from '@/lib/studio';
import { money, plural, weekdayDayMonth } from '@/lib/format';

/** Регулярное занятие или день смены: в долге это первое, что спрашивают. */
function kindOf(c: UnpaidCharge): string {
  if (c.kind === 'camp') return 'лагерь';
  if (c.kind === 'event') return 'мастер-класс';
  return 'регулярное';
}

/**
 * Выбор занятий к оплате. Родитель может заплатить не за всё сразу,
 * поэтому итог считается по отмеченным.
 *
 * Строки набраны так же, как в «Истории»: день заголовком на всех, кто в
 * него попал, и колонки под ним. Списки одинаковые по смыслу, и выглядеть
 * они должны одинаково.
 */
export default function DebtPicker({
  charges,
  online,
}: {
  charges: UnpaidCharge[];
  online: boolean;
}) {
  // Заявленные наличными уже ждут подтверждения: их не выбираем.
  const payable = charges.filter((c) => !c.declared);
  const [picked, setPicked] = useState<Set<string>>(() => new Set(payable.map((c) => c.id)));
  const currency = charges[0]?.currency ?? 'ILS';
  const total = payable
    .filter((c) => picked.has(c.id))
    .reduce((s, c) => s + Number(c.amount), 0);

  function toggle(id: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const all = picked.size === payable.length;

  // День → занятия этого дня: дата пишется один раз на всех.
  const byDay = new Map<string, UnpaidCharge[]>();
  for (const c of charges) byDay.set(c.held_on, [...(byDay.get(c.held_on) ?? []), c]);

  return (
    <form>
      <div className="row" style={{ marginBottom: 6 }}>
        <p className="hint" style={{ margin: 0 }}>
          Отмечено {picked.size} из {payable.length}
        </p>
        <button
          type="button"
          className="chip-money money"
          onClick={() => setPicked(all ? new Set() : new Set(payable.map((c) => c.id)))}
        >
          {all ? 'снять все' : 'выбрать все'}
        </button>
      </div>

      {[...byDay.entries()].map(([day, list]) => (
        <div key={day}>
          <div className="when visit-day">{weekdayDayMonth(day)}</div>
          {list.map((c) => {
            if (c.declared) {
              return (
                <div className="visit" key={c.id} style={{ opacity: 0.55 }}>
                  <span className="box box-sm" />
                  <span className="visit-who">{c.who}</span>
                  <span className="visit-sum">{money(c.amount, c.currency)}</span>
                  <span className="visit-how">{kindOf(c)} · ждёт подтверждения</span>
                </div>
              );
            }
            const on = picked.has(c.id);
            return (
              <button type="button" className="visit debt" key={c.id}
                      onClick={() => toggle(c.id)} aria-pressed={on}
                      aria-label={`${c.who}, ${money(c.amount, c.currency)}: ${
                        on ? 'не платить сейчас' : 'оплатить'}`}>
                {on && <input type="hidden" name="charge" value={c.id} />}
                <span className={on ? 'box box-sm box-on' : 'box box-sm'}>
                  {on && (
                    <svg viewBox="0 0 24 24"><path d="M4 12.5 L9.5 18 L20 6" /></svg>
                  )}
                </span>
                <span className="visit-who" style={{ opacity: on ? 1 : 0.55 }}>{c.who}</span>
                <span className="visit-sum" style={{ opacity: on ? 1 : 0.55 }}>
                  {money(c.amount, c.currency)}
                </span>
                <span className="visit-how">{kindOf(c)}</span>
              </button>
            );
          })}
        </div>
      ))}

      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
        padding: '18px 2px 20px', borderTop: '1px solid var(--line)', marginTop: 12,
      }}>
        <div style={{ fontSize: 12, letterSpacing: '0.2em', textTransform: 'uppercase', color: 'var(--warm-gray)' }}>
          Итого за {picked.size}&nbsp;{plural(picked.size, 'занятие', 'занятия', 'занятий')}
        </div>
        <div className="sum sum-big">{money(total, currency)}</div>
      </div>

      {payable.length === 0 && (
        <p className="hint">Все занятия уже заявлены к оплате наличными или переводом.</p>
      )}

      {/* Три способа в ряд: карта уводит в банк сразу, перевод и наличные
          только сообщают Варе, чего ждать. */}
      <div className="lbl" style={{ margin: '0 0 8px' }}>Способ оплаты</div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button className="btn" formAction={payDebtAction}
                disabled={picked.size === 0 || !online}
                style={{ flex: '1 1 96px' }}>
          Карта
        </button>
        <button className="btn-quiet" formAction={declareTransferAction}
                disabled={picked.size === 0} style={{ flex: '1 1 96px' }}>
          Перевод
        </button>
        <button className="btn-quiet" formAction={declareCashAction}
                disabled={picked.size === 0} style={{ flex: '1 1 96px' }}>
          Наличные
        </button>
      </div>

      <p className="hint" style={{ marginTop: 14 }}>
        {online
          ? 'Картой — на защищённой странице банка. '
          : 'Оплата картой ещё не подключена. '}
        Перевод и наличные Варя подтвердит на занятии: до этого занятия
        остаются неоплаченными.
      </p>
    </form>
  );
}
