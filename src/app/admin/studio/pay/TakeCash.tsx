'use client';

import { useActionState, useEffect, useState } from 'react';
import { takeCashAction } from '@/app/admin/pay-actions';
import type { UnpaidCharge } from '@/lib/studio';
import { money, plural, WAY, WAYS, weekdayDayMonth } from '@/lib/format';

/** Регулярное занятие или день смены: в долге это первое, что спрашивают. */
function kindOf(c: UnpaidCharge): string {
  if (c.kind === 'camp') return 'лагерь';
  if (c.kind === 'event') return 'мастер-класс';
  return 'регулярное';
}

/**
 * Приём денег у стойки: отметили занятия, назвали способ, выписали чек.
 *
 * Список тот же, что видит у себя родитель, и набран так же — иначе,
 * стоя рядом, они смотрели бы в два разных списка и спорили, за что
 * платят. Заявленное родителем отсюда не проводится: у такой заявки
 * своя кнопка, иначе за одни деньги вышло бы два платежа.
 */
export default function TakeCash({
  ownerId,
  charges,
  receipts,
}: {
  ownerId: string;
  charges: UnpaidCharge[];
  receipts: boolean;
}) {
  const payable = charges.filter((c) => !c.declared);
  const [picked, setPicked] = useState<Set<string>>(() => new Set(payable.map((c) => c.id)));
  const currency = charges[0]?.currency ?? 'ILS';
  const total = payable
    .filter((c) => picked.has(c.id))
    .reduce((s, c) => s + Number(c.amount), 0);

  // Провели оплату — список пришёл заново, уже без неё. Отметки держим
  // при нём, иначе счётчик считает занятия, которых больше нет.
  const ids = charges.map((c) => c.id).join(',');
  useEffect(() => {
    setPicked(new Set(charges.filter((c) => !c.declared).map((c) => c.id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids]);

  const [res, submit, pending] = useActionState(
    async (_prev: { ok: boolean; error?: string } | null, form: FormData) =>
      takeCashAction(form),
    null,
  );

  function toggle(id: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const all = picked.size === payable.length && payable.length > 0;

  const byDay = new Map<string, UnpaidCharge[]>();
  for (const c of charges) byDay.set(c.held_on, [...(byDay.get(c.held_on) ?? []), c]);

  return (
    <form action={submit}>
      <input type="hidden" name="ownerId" value={ownerId} />

      <div className="row" style={{ marginBottom: 6 }}>
        <p className="hint" style={{ margin: 0 }}>
          Отмечено {picked.size} из {payable.length}
        </p>
        {payable.length > 0 && (
          <button type="button" className="chip-money money"
                  onClick={() => setPicked(all ? new Set() : new Set(payable.map((c) => c.id)))}>
            {all ? 'снять все' : 'выбрать все'}
          </button>
        )}
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
                  <span className="visit-how">{kindOf(c)} · заявлено родителем</span>
                </div>
              );
            }
            const on = picked.has(c.id);
            return (
              <button type="button" className="visit debt" key={c.id}
                      onClick={() => toggle(c.id)} aria-pressed={on}
                      aria-label={`${c.who}, ${money(c.amount, c.currency)}: ${
                        on ? 'не проводить' : 'принять оплату'}`}>
                {on && <input type="hidden" name="charge" value={c.id} />}
                <span className={on ? 'box box-sm box-on' : 'box box-sm'}>
                  {on && <svg viewBox="0 0 24 24"><path d="M4 12.5 L9.5 18 L20 6" /></svg>}
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
        <div style={{ fontSize: 12, letterSpacing: '0.2em', textTransform: 'uppercase',
                      color: 'var(--warm-gray)' }}>
          Итого за {picked.size}&nbsp;{plural(picked.size, 'занятие', 'занятия', 'занятий')}
        </div>
        <div className="sum sum-big">{money(total, currency)}</div>
      </div>

      {/* Способ спрашиваем всегда, а не подставляем: от него зависит, каким
          блоком уйдёт чек, а деньги в руки и деньги на счёт — разные места
          в отчётности. */}
      <div className="field" style={{ marginBottom: 16, maxWidth: 280 }}>
        <label htmlFor={`how-${ownerId}`}>Чем заплатили</label>
        <select id={`how-${ownerId}`} name="payMethod" required defaultValue="cash">
          {WAYS.map((w) => <option key={w} value={w}>{WAY[w]}</option>)}
        </select>
      </div>

      <label style={{ display: 'flex', gap: 10, alignItems: 'center',
                      marginBottom: 18, cursor: 'pointer' }}>
        <input type="checkbox" name="receipt" style={{ width: 20, height: 20 }} />
        <span className="hint">
          Выписать чек в iCount{receipts ? '' : ' — сейчас не подключён'}
        </span>
      </label>

      <button className="btn-wide" type="submit" disabled={pending || picked.size === 0}>
        {pending ? 'Проводим…' : 'Деньги получены'}
      </button>

      {res && !res.ok && (
        <p className="err" style={{ marginTop: 12 }}>{res.error}</p>
      )}
      {res?.ok && (
        <p className="hint" style={{ marginTop: 12 }}>
          Оплата проведена. Родителю ушло сообщение, если у него подключён бот.
        </p>
      )}
    </form>
  );
}
