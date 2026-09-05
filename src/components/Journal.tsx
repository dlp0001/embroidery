'use client';

import { useState } from 'react';
import { saveJournal } from '@/app/admin/actions';
import type { RosterRow } from '@/lib/studio';

type Row = { present: boolean; cash: boolean };

/**
 * Журнал одного занятия. Все заранее отмечены пришедшими, деньги
 * посчитаны сами. Обычный день — одно нажатие на «Сохранить».
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
        { present: r.status ? r.status === 'present' : true, cash: r.cash },
      ]),
    ),
  );

  const present = Object.values(rows).filter((r) => r.present).length;

  function moneyFor(r: RosterRow): { text: string; cls: string } {
    const row = rows[r.participant_id];
    if (!row.present) return { text: 'пропуск', cls: 'money-off' };
    if (row.cash) return { text: 'оплачено налом', cls: 'money' };
    if (r.on_pass || r.has_pass) return { text: 'по абонементу', cls: 'money' };
    if (r.paid) return { text: 'оплачено', cls: 'money' };
    return { text: `не оплачено · ${price}`, cls: 'money-due' };
  }

  return (
    <form action={saveJournal}>
      <input type="hidden" name="sessionId" value={sessionId} />

      {roster.map((r) => {
        const row = rows[r.participant_id];
        const m = moneyFor(r);
        return (
          <div className="mark" key={r.participant_id}>
            <input type="hidden" name={`mark:${r.participant_id}`} value={row.present ? 'present' : 'absent'} />
            <input type="hidden" name={`cash:${r.participant_id}`} value={row.cash ? '1' : '0'} />

            <div style={{ flex: 1, minWidth: 0 }}>
              <button
                type="button"
                className="plain"
                onClick={() =>
                  setRows((p) => ({ ...p, [r.participant_id]: { ...p[r.participant_id], present: !p[r.participant_id].present } }))
                }
              >
                <span className={row.present ? 'nm' : 'nm-off'}>{r.who}</span>
              </button>

              <button
                type="button"
                className={`chip-money ${m.cls}`}
                disabled={!row.present}
                onClick={() =>
                  setRows((p) => ({ ...p, [r.participant_id]: { ...p[r.participant_id], cash: !p[r.participant_id].cash } }))
                }
              >
                {m.text}
              </button>
            </div>

            <button
              type="button"
              aria-label={`${r.who}: ${row.present ? 'снять отметку' : 'отметить'}`}
              aria-pressed={row.present}
              className={row.present ? 'dot-on' : 'dot-off'}
              onClick={() =>
                setRows((p) => ({ ...p, [r.participant_id]: { ...p[r.participant_id], present: !p[r.participant_id].present } }))
              }
            >
              {row.present && (
                <svg viewBox="0 0 24 24">
                  <path d="M4 12.5 L9.5 18 L20 6" />
                </svg>
              )}
            </button>
          </div>
        );
      })}

      <button className="btn-wide" type="submit" style={{ marginTop: 14 }}>
        {saved ? 'Пересохранить' : 'Сохранить'} · отмечено {present}
      </button>
    </form>
  );
}
