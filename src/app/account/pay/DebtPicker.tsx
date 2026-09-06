'use client';

import { useState } from 'react';
import { declareCashAction, payDebtAction } from './actions';
import type { UnpaidCharge } from '@/lib/studio';
import { dayMonth, money, plural } from '@/lib/format';

/**
 * Выбор занятий к оплате. Родитель может заплатить не за всё сразу,
 * поэтому итог считается по отмеченным.
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

  return (
    <form>
      <div className="row" style={{ marginBottom: 12 }}>
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

      {charges.map((c) => {
        if (c.declared) {
          return (
            <div className="card" key={c.id}>
              <div className="row">
                <div>
                  <div className="when">{dayMonth(c.held_on)} · {c.group_title}</div>
                  <div className="what">{c.who}</div>
                  <div className="money">будет оплачено наличными или переводом</div>
                </div>
                <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 20 }}>
                  {money(c.amount, c.currency)}
                </div>
              </div>
            </div>
          );
        }
        const on = picked.has(c.id);
        return (
          <div className="card" key={c.id} style={{ opacity: on ? 1 : 0.5 }}>
            {on && <input type="hidden" name="charge" value={c.id} />}
            <button type="button" className="pick" onClick={() => toggle(c.id)} aria-pressed={on}>
              <span className={on ? 'box box-on' : 'box'}>
                {on && (
                  <svg viewBox="0 0 24 24">
                    <path d="M4 12.5 L9.5 18 L20 6" />
                  </svg>
                )}
              </span>
              <span style={{ flex: 1, textAlign: 'left' }}>
                <span className="when" style={{ display: 'block', marginBottom: 2 }}>
                  {dayMonth(c.held_on)} · {c.group_title}
                </span>
                <span className={on ? 'pick-name pick-on' : 'pick-name'}>{c.who}</span>
              </span>
              <span style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 20 }}>
                {money(c.amount, c.currency)}
              </span>
            </button>
          </div>
        );
      })}

      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
        padding: '20px 2px 22px', borderTop: '1px solid var(--line)', marginTop: 12,
      }}>
        <div style={{ fontSize: 12, letterSpacing: '0.2em', textTransform: 'uppercase', color: 'var(--warm-gray)' }}>
          Итого за {picked.size}&nbsp;{plural(picked.size, 'занятие', 'занятия', 'занятий')}
        </div>
        <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 34 }}>
          {money(total, currency)}
        </div>
      </div>

      {payable.length === 0 && (
        <p className="hint">Все занятия уже заявлены к оплате наличными или переводом.</p>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <button className="btn-wide" formAction={payDebtAction} disabled={picked.size === 0 || !online}>
          Оплатить картой
        </button>
        <button className="btn-quiet" formAction={declareCashAction} disabled={picked.size === 0}
                style={{ width: '100%' }}>
          Заплачу наличными или переведу
        </button>
      </div>

      <p className="hint" style={{ marginTop: 14 }}>
        {online
          ? 'Картой — на защищённой странице банка. Оплату наличными, битом или пейбоксом Варя подтвердит на занятии, до этого занятия остаются неоплаченными.'
          : 'Оплата картой ещё не подключена. Оплату наличными, битом или пейбоксом Варя подтвердит на занятии, до этого занятия остаются неоплаченными.'}
      </p>
    </form>
  );
}
