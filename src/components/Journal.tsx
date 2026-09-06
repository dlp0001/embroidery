'use client';

import { useState } from 'react';
import { saveJournal } from '@/app/admin/actions';
import type { RosterRow } from '@/lib/studio';

type Row = { present: boolean; cash: boolean };

/** Ждём ли этого человека: родитель записал или день отмечен в профиле. */
function expected(r: RosterRow): boolean {
  return r.booked || r.preferred;
}

/**
 * Журнал одного занятия. Ожидаемые заранее отмечены, остальные нет.
 * Деньги считаются сами, руками ставятся только наличные.
 */
export default function Journal({
  sessionId,
  roster,
  price,
  saved,
}: {
  sessionId: string;
  roster: RosterRow[];
  price: string;
  saved: boolean;
}) {
  const [rows, setRows] = useState<Record<string, Row>>(() =>
    Object.fromEntries(
      roster.map((r) => [
        r.participant_id,
        { present: r.status === 'present', cash: r.cash },
      ]),
    ),
  );

  // Строки с проведёнными деньгами открываются только после подтверждения.
  const [unlocked, setUnlocked] = useState<Set<string>>(new Set());
  const [asking, setAsking] = useState<string | null>(null);

  const present = Object.values(rows).filter((r) => r.present).length;
  const likely = roster.filter(expected);
  const rest = roster.filter((r) => !expected(r));
  const split = likely.length > 0 && rest.length > 0;

  function moneyFor(r: RosterRow): { text: string; cls: string } | null {
    const row = rows[r.participant_id];
    // Никого не отмечаем заранее. Пока человек не отмечен, про деньги
    // говорить нечего: «пропуск» пишем только там, где журнал уже закрыт.
    if (!row.present) return r.status ? { text: 'пропуск', cls: 'money-off' } : null;
    if (row.cash) return { text: 'оплачено налом', cls: 'money' };
    // Оплату картой отсюда не снять, поэтому она и не переключается.
    if (r.paid && !r.cash) return { text: 'оплачено картой', cls: 'money' };
    // Дальше — то, что станет правдой после сохранения, а не то, что
    // лежит в базе сейчас: галочку наличных мы как раз собираемся снять.
    if (r.on_pass && !r.cash) return { text: 'по абонементу', cls: 'money' };
    if (r.has_pass) return { text: 'спишется с абонемента', cls: 'money' };
    return { text: `не оплачено · ${price}`, cls: 'money-due' };
  }

  function toggle(id: string, field: keyof Row) {
    setRows((p) => ({ ...p, [id]: { ...p[id], [field]: !p[id][field] } }));
  }

  function line(r: RosterRow) {
    const row = rows[r.participant_id];
    const m = moneyFor(r);
    const settled = (r.cash || r.paid || r.on_pass) && !unlocked.has(r.participant_id);

    // По проведённым деньгам сначала спрашиваем, потом пускаем.
    if (settled) {
      const text = r.cash ? 'оплачено налом'
        : r.paid ? 'оплачено картой'
        : 'списано с абонемента';
      const askingHere = asking === r.participant_id;
      return (
        <div key={r.participant_id} style={{ borderBottom: '1px solid var(--line-soft)' }}>
          <div className="mark" style={{ borderBottom: 0 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className={row.present ? 'nm' : 'nm-off'}>{r.who}</div>
              <div className="money">{text} · записано</div>
            </div>
            <button
              type="button"
              className="btn-quiet"
              style={{ minHeight: 38, padding: '8px 14px' }}
              onClick={() => setAsking(askingHere ? null : r.participant_id)}
            >
              Изменить
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
      <div className="mark" key={r.participant_id}>
        <input type="hidden" name={`mark:${r.participant_id}`} value={row.present ? 'present' : 'absent'} />
        <input type="hidden" name={`cash:${r.participant_id}`} value={row.cash ? '1' : '0'} />

        <div style={{ flex: 1, minWidth: 0 }}>
          <button type="button" className="plain" onClick={() => toggle(r.participant_id, 'present')}>
            <span className={row.present ? 'nm' : 'nm-off'}>{r.who}</span>
          </button>
          {m && (
            <button
              type="button"
              className={`chip-money ${m.cls}`}
              disabled={!row.present || (r.paid && !r.cash)}
              onClick={() => toggle(r.participant_id, 'cash')}
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
          onClick={() => toggle(r.participant_id, 'present')}
        >
          {row.present && (
            <svg viewBox="0 0 24 24">
              <path d="M4 12.5 L9.5 18 L20 6" />
            </svg>
          )}
        </button>
      </div>
    );
  }

  return (
    <form action={saveJournal}>
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

      <button className="btn-wide" type="submit" style={{ marginTop: 14 }}>
        {saved ? 'Пересохранить' : 'Сохранить'} · отмечено {present}
      </button>
      {unlocked.size > 0 && (
        <p className="hint" style={{ marginTop: 12 }}>
          Открыто для правки: {unlocked.size}. После сохранения изменение появится в реестре.
        </p>
      )}
    </form>
  );
}
