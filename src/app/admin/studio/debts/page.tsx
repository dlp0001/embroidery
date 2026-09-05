import { debtors } from '@/lib/studio';
import { dayMonth, money, plural } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function DebtsPage() {
  const rows = await debtors();
  const total = rows.reduce((s, d) => s + Number(d.amount), 0);

  return (
    <>
      <div className="top">
        <div className="kicker">Re.Create.Art · Преподаватель</div>
        <h1 className="h1">Долги</h1>
        {rows.length > 0 && (
          <p className="sub">{rows.length}&nbsp;{plural(rows.length, 'семья', 'семьи', 'семей')} на {money(total, rows[0].currency)}</p>
        )}
      </div>
      <div className="body">
        {rows.length === 0 && <p className="hint" style={{ marginTop: 20 }}>Долгов нет.</p>}
        {rows.map((d) => (
          <div className="card" key={d.owner_id}>
            <div className="row">
              <div>
                <div className="what">{d.name ?? d.email}</div>
                <div className="sub">{d.who} · {d.lessons}&nbsp;{plural(d.lessons, 'занятие', 'занятия', 'занятий')} с {dayMonth(d.since)}</div>
              </div>
              <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 21, color: 'var(--rose-dark)' }}>
                {money(d.amount, d.currency)}
              </div>
            </div>
          </div>
        ))}
        {rows.length > 0 && (
          <p className="hint" style={{ marginTop: 18 }}>
            Рассылка напоминаний появится вместе с оплатой через PayPlus.
          </p>
        )}
      </div>
    </>
  );
}
