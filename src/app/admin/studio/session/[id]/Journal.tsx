'use client';

import { useState } from 'react';
import { saveJournal } from '@/app/admin/actions';
import type { AttendanceStatus, RosterRow } from '@/lib/studio';

const OPTIONS: { value: AttendanceStatus; label: string; hint: string }[] = [
  { value: 'present', label: 'Присутствие', hint: 'Спишется с абонемента или уйдёт в долг' },
  { value: 'absent', label: 'Пропуск', hint: 'Ничего не списывается' },
  { value: 'sick', label: 'Болезнь', hint: 'Занятие не сгорает и не оплачивается' },
  { value: 'trial', label: 'Пробное', hint: 'Бесплатно, без списания' },
];

const SHORT: Partial<Record<AttendanceStatus, string>> = { sick: 'Б', trial: 'П' };

export default function Journal({
  sessionId,
  roster,
  price,
}: {
  sessionId: string;
  roster: RosterRow[];
  price: string;
}) {
  const [marks, setMarks] = useState<Record<string, AttendanceStatus>>(() =>
    Object.fromEntries(roster.map((r) => [r.participant_id, r.status ?? 'present'])),
  );
  const [open, setOpen] = useState<string | null>(null);

  const present = Object.values(marks).filter((s) => s === 'present').length;

  function money(row: RosterRow): { text: string; cls: string } {
    const status = marks[row.participant_id];
    if (status === 'sick') return { text: 'Болезнь, занятие не сгорает', cls: 'money' };
    if (status === 'absent') return { text: 'Пропуск, ничего не спишется', cls: 'money-off' };
    if (status === 'trial') return { text: 'Пробное, бесплатно', cls: 'money' };
    if (row.paid) return { text: 'Оплачено отдельно', cls: 'money' };
    if (row.on_pass || row.has_pass) return { text: 'Спишется с абонемента', cls: 'money' };
    return { text: `${price} в долг · нет абонемента`, cls: 'money-due' };
  }

  return (
    <form action={saveJournal}>
      <input type="hidden" name="sessionId" value={sessionId} />
      {roster.map((row) => {
        const status = marks[row.participant_id];
        const m = money(row);
        const isOpen = open === row.participant_id;
        return (
          <div key={row.participant_id}>
            <input type="hidden" name={`mark:${row.participant_id}`} value={status} />
            <div className="mark">
              <button
                type="button"
                onClick={() => setOpen(isOpen ? null : row.participant_id)}
                style={{ background: 'none', border: 0, textAlign: 'left', cursor: 'pointer', flex: 1, padding: 0 }}
                aria-expanded={isOpen}
              >
                <div className={status === 'absent' ? 'nm-off' : 'nm'}>{row.who}</div>
                <div className={m.cls}>{m.text}</div>
              </button>
              <button
                type="button"
                aria-label={status === 'present' ? `Снять отметку: ${row.who}` : `Отметить: ${row.who}`}
                onClick={() =>
                  setMarks((prev) => ({
                    ...prev,
                    [row.participant_id]: prev[row.participant_id] === 'present' ? 'absent' : 'present',
                  }))
                }
                className={status === 'present' ? 'dot-on' : SHORT[status] ? 'dot-alt' : 'dot-off'}
                style={{ cursor: 'pointer', padding: 0 }}
              >
                {status === 'present' && (
                  <svg viewBox="0 0 24 24" style={{ width: 18, height: 18, fill: 'none', stroke: '#fff', strokeWidth: 2.5, strokeLinecap: 'round', strokeLinejoin: 'round' }}>
                    <path d="M4 12.5 L9.5 18 L20 6" />
                  </svg>
                )}
                {SHORT[status]}
              </button>
            </div>

            {isOpen && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '12px 0 18px' }}>
                {OPTIONS.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    onClick={() => {
                      setMarks((prev) => ({ ...prev, [row.participant_id]: o.value }));
                      setOpen(null);
                    }}
                    style={{
                      textAlign: 'left', cursor: 'pointer', padding: '13px 16px', minHeight: 44,
                      background: status === o.value ? 'rgba(233,30,140,0.05)' : 'transparent',
                      border: `1.5px solid ${status === o.value ? 'var(--rose)' : 'rgba(26,26,46,0.12)'}`,
                    }}
                  >
                    <div style={{ fontSize: 15 }}>{o.label}</div>
                    <div style={{ fontSize: 12, color: 'var(--warm-gray)', marginTop: 2 }}>{o.hint}</div>
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}

      <div className="bar" style={{ marginTop: 18 }}>
        <button className="btn-wide" type="submit">Сохранить · отмечено {present}</button>
      </div>
    </form>
  );
}
