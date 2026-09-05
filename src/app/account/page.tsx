import { requireUser } from '@/lib/session';
import { passBalances, unpaidCharges, upcomingForUser, type UpcomingRow } from '@/lib/studio';
import { dayMonth, hhmm, money, plural, weekdayDayMonth } from '@/lib/format';
import { toggleBooking } from './actions';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default async function WeekPage() {
  const user = await requireUser();
  const [passes, unpaid, upcoming] = await Promise.all([
    passBalances(user.id),
    unpaidCharges(user.id),
    upcomingForUser(user.id, 7),
  ]);

  const pass = passes.find((p) => p.left > 0) ?? null;
  const debt = unpaid.reduce((sum, c) => sum + Number(c.amount), 0);

  const byDay = new Map<string, UpcomingRow[]>();
  for (const row of upcoming) {
    const list = byDay.get(row.held_on) ?? [];
    list.push(row);
    byDay.set(row.held_on, list);
  }

  return (
    <>
      <div className="top">
        <div className="kicker">Re.Create.Art · Студия</div>
        <h1 className="h1">Эта неделя</h1>
      </div>

      <div className="body">
        {pass && (
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
              <div className="what">Абонемент</div>
              <div style={{ fontSize: 13, color: 'var(--warm-gray)' }}>
                осталось {pass.left} из {pass.lessons_total}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 4, marginBottom: 10 }}>
              {Array.from({ length: pass.lessons_total }, (_, i) => (
                <div key={i} style={{
                  height: 6, flexGrow: 1,
                  background: i < pass.used ? 'var(--rose-light)' : 'var(--rose)',
                }} />
              ))}
            </div>
            <div className="sub">Общий на всех. Списывается с того, кто пришёл.</div>
          </div>
        )}

        {unpaid.length > 0 && (
          <div className="card-lin">
            <div className="row">
              <div>
                <div className="what">Не оплачено {unpaid.length}&nbsp;{plural(unpaid.length, 'занятие', 'занятия', 'занятий')}</div>
                <div className="sub">
                  с {dayMonth(unpaid[0].held_on)} ·{' '}
                  <span style={{ color: 'var(--rose-dark)' }}>{money(debt, unpaid[0].currency)}</span>
                </div>
              </div>
              <Link className="btn" href="/account/pay">Оплатить</Link>
            </div>
          </div>
        )}

        {byDay.size === 0 && (
          <p className="hint" style={{ marginTop: 20 }}>
            На ближайшую неделю занятий нет. Загляните в календарь.
          </p>
        )}

        {[...byDay.entries()].map(([day, rows]) => (
          <section key={day}>
            <div className="lbl">{weekdayDayMonth(day)}</div>
            {rows.map((row) => (
              <div className="card" key={`${row.session_id}-${row.participant_id}`}>
                <div className="row">
                  <div>
                    <div className="when">{hhmm(row.starts_at)} · {row.group_title}</div>
                    <div className="what">{row.who}</div>
                    <div className="sub">
                      {row.booked ? 'Место закреплено' : 'Пока без записи'}
                    </div>
                  </div>
                  <form action={toggleBooking}>
                    <input type="hidden" name="sessionId" value={row.session_id} />
                    <input type="hidden" name="participantId" value={row.participant_id} />
                    <input type="hidden" name="booked" value={row.booked ? '0' : '1'} />
                    <button className={row.booked ? 'btn-quiet' : 'btn'} type="submit">
                      {row.booked ? 'Отменить' : 'Записать'}
                    </button>
                  </form>
                </div>
              </div>
            ))}
          </section>
        ))}
      </div>
    </>
  );
}

