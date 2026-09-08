'use client';

import { useActionState, useState } from 'react';
import { addWalkInAction, saveJournal } from '@/app/admin/actions';
import type { PayWay, RosterRow } from '@/lib/studio';

type Row = { present: boolean; pay: PayWay };

/** Ждём ли этого человека: родитель записал или день отмечен в профиле. */
function expected(r: RosterRow): boolean {
  return r.booked || r.preferred;
}

/** Родитель записал ребёнка именно на это занятие, а не «обычно ходит». */
function Booked({ on }: { on: boolean }) {
  if (!on) return null;
  return <div className="signed">записан</div>;
}

/** Абонемент можно выбрать, только если он есть или занятие уже на нём. */
function ways(r: RosterRow): PayWay[] {
  return r.has_pass || r.on_pass ? ['none', 'cash', 'pass'] : ['none', 'cash'];
}

/** Ребёнка привели, а родителя у него ещё нет: платить пока некому. */
function NoParent({ on }: { on: boolean }) {
  if (!on) return null;
  return <div className="money-off">родитель не привязан</div>;
}

/** Что уже проведено по деньгам: это и требует подтверждения при правке. */
function settledWay(r: RosterRow): PayWay | null {
  if (r.cash) return 'cash';
  if (r.on_pass) return 'pass';
  return null;
}

/**
 * Журнал одного занятия. Кто был — отмечает Варя, статус оплаты
 * подставляется сам: есть абонемент — «по абонементу», нет — «не оплачено».
 */
/** Что показываем до того, как Варя что-то тронула. */
function defaults(r: RosterRow): Row {
  return {
    present: r.status === 'present',
    // Абонемент подставляем только тем, по кому занятие ещё не считали:
    // сохранённое «не оплачено» подменять нельзя.
    pay: settledWay(r) ?? (!r.locked && r.has_pass ? 'pass' : 'none'),
  };
}

export default function Journal({
  sessionId,
  roster,
  price,
  saved,
  kids = false,
}: {
  sessionId: string;
  roster: RosterRow[];
  price: string;
  saved: boolean;
  /** Детское занятие: сюда можно завести ребёнка прямо с порога. */
  kids?: boolean;
}) {
  const [edits, setEdits] = useState<Record<string, Row>>({});
  const rowFor = (r: RosterRow): Row => edits[r.participant_id] ?? defaults(r);

  // Строки с проведёнными деньгами открываются только после подтверждения.
  const [unlocked, setUnlocked] = useState<Set<string>>(new Set());
  const [asking, setAsking] = useState<string | null>(null);

  // Отправка через useActionState: нужна и «сохраняю…», и отметка о том,
  // что сохранение уже прошло. Раньше про это говорил адрес страницы,
  // ради которого делался лишний переход.
  const [savedAt, submit, pending] = useActionState<number, FormData>(
    async (_prev, form) => {
      await saveJournal(form);
      return Date.now();
    },
    0,
  );

  const present = roster.filter((r) => rowFor(r).present).length;
  // Записавшиеся — первыми: их ждут наверняка, остальных по привычке.
  // Сортировка устойчивая, поэтому внутри каждой части имена по алфавиту.
  const likely = roster.filter(expected)
    .slice()
    .sort((a, b) => Number(b.booked) - Number(a.booked));
  const rest = roster.filter((r) => !expected(r));
  const split = likely.length > 0 && rest.length > 0;

  function moneyFor(r: RosterRow): { text: string; cls: string } | null {
    const row = rowFor(r);
    // Никого не отмечаем заранее. Пока человек не отмечен, про деньги
    // говорить нечего: «пропуск» пишем только там, где журнал уже закрыт.
    if (!row.present) return r.status ? { text: 'пропуск', cls: 'money-off' } : null;
    // Оплату картой из журнала не снять: деньги пришли через банк.
    if (r.paid && !r.cash) return { text: 'оплачено картой', cls: 'money' };
    if (row.pay === 'cash') return { text: 'оплачено наличными или переводом', cls: 'money' };
    if (row.pay === 'pass') return { text: 'по абонементу', cls: 'money' };
    return { text: `не оплачено · ${price}`, cls: 'money-due' };
  }

  function togglePresent(r: RosterRow) {
    const row = rowFor(r);
    setEdits((p) => ({ ...p, [r.participant_id]: { ...row, present: !row.present } }));
  }

  /** Клик по статусу оплаты гоняет его по кругу: три варианта или два. */
  function nextWay(r: RosterRow) {
    const list = ways(r);
    const row = rowFor(r);
    const at = list.indexOf(row.pay);
    setEdits((p) => ({ ...p, [r.participant_id]: { ...row, pay: list[(at + 1) % list.length] } }));
  }

  function line(r: RosterRow) {
    const row = rowFor(r);
    const m = moneyFor(r);
    const card = r.paid && !r.cash;
    const settled = Boolean(card || settledWay(r));
    // Проведённые деньги не запрещают правку, но спрашивают перед ней.
    const locked = settled && !unlocked.has(r.participant_id);
    const askingHere = asking === r.participant_id;

    /** Любое касание закрытой строки сначала спрашивает, потом делает. */
    const guard = (act: () => void) => () => {
      if (locked) setAsking(askingHere ? null : r.participant_id);
      else act();
    };

    return (
      <div key={r.participant_id}>
        <div className="mark">
          <input type="hidden" name={`mark:${r.participant_id}`} value={row.present ? 'present' : 'absent'} />
          <input type="hidden" name={`pay:${r.participant_id}`} value={row.pay} />

          <div style={{ flex: 1, minWidth: 0 }}>
            <button type="button" className="plain" onClick={guard(() => togglePresent(r))}>
              <span className={row.present ? 'nm' : 'nm-off'}>{r.who}</span>
            </button>
            <Booked on={r.booked} />
            <NoParent on={!r.owner_id} />
            {m && (
              <button
                type="button"
                className={`chip-money ${m.cls}`}
                disabled={!row.present || card}
                onClick={guard(() => nextWay(r))}
              >
                {m.text}
              </button>
            )}
          </div>

          <button
            type="button"
            aria-label={`${r.who}: ${row.present ? 'снять отметку' : 'отметить'}`}
            aria-pressed={row.present}
            className={row.present ? 'dot-on' : 'dot-off'}
            onClick={guard(() => togglePresent(r))}
          >
            {row.present && (
              <svg viewBox="0 0 24 24">
                <path d="M4 12.5 L9.5 18 L20 6" />
              </svg>
            )}
          </button>
        </div>

        {askingHere && (
          <div className="note" style={{ margin: '0 0 14px' }}>
            По этому занятию деньги уже проведены. Изменение попадёт в реестр
            и будет видно, кто его сделал.
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setUnlocked((p) => new Set(p).add(r.participant_id));
                  setAsking(null);
                }}
              >
                Всё равно изменить
              </button>
              <button type="button" className="btn-quiet" onClick={() => setAsking(null)}>
                Отмена
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <>
      <form action={submit}>
      <input type="hidden" name="sessionId" value={sessionId} />

      {/* Заголовки нужны, только когда список действительно разделён */}
      {likely.length > 0 && (
        <>
          {split && <div className="lbl" style={{ marginTop: 6 }}>Ждём</div>}
          {likely.map(line)}
        </>
      )}

      {rest.length > 0 && (
        <>
          {split && <div className="lbl">Остальные</div>}
          {rest.map(line)}
        </>
      )}

      <button className="btn-wide" type="submit" style={{ marginTop: 14 }} disabled={pending}>
        {pending
          ? 'Сохраняю…'
          : `${saved ? 'Пересохранить' : 'Сохранить'} · отмечено ${present}`}
      </button>
      {savedAt > 0 && !pending && (
        <p className="hint" style={{ marginTop: 12 }}>Сохранено.</p>
      )}
      {unlocked.size > 0 && (
        <p className="hint" style={{ marginTop: 12 }}>
          Открыто для правки: {unlocked.size}. После сохранения изменение появится в реестре.
        </p>
      )}
      </form>

      {kids && (
        <form
          action={addWalkInAction}
          style={{ display: 'flex', gap: 10, alignItems: 'flex-end', marginTop: 18 }}
        >
          <input type="hidden" name="sessionId" value={sessionId} />
          <div className="field" style={{ flex: 1, marginBottom: 0 }}>
            <label htmlFor={`walkin-${sessionId}`}>Привели нового</label>
            <input
              id={`walkin-${sessionId}`}
              name="name"
              maxLength={120}
              placeholder="Имя и фамилия"
            />
          </div>
          <button className="btn-quiet" type="submit">Добавить</button>
        </form>
      )}
    </>
  );
}
