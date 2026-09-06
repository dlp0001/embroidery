import Link from 'next/link';
import BookingHint from '@/components/BookingHint';
import SlotList from '@/components/SlotList';
import { requireUser } from '@/lib/session';
import { passBalances, slotsForUser, unpaidCharges } from '@/lib/studio';
import { dayMonth, money, plural, todayISO, weekdayDayMonth } from '@/lib/format';

export const dynamic = 'force-dynamic';

function plusDays(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

export default async function WeekPage() {
  const user = await requireUser();
  const today = todayISO();
  const [passes, unpaid, slots] = await Promise.all([
    passBalances(user.id),
    unpaidCharges(user.id),
    slotsForUser(user.id, today, plusDays(today, 7)),
  ]);

  const pass = passes.find((p) => p.left > 0) ?? null;
  const debt = unpaid.reduce((sum, c) => sum + Number(c.amount), 0);

  const days = [...new Set(slots.map((s) => s.held_on))];

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
                <div key={i} style={{ height: 6, flexGrow: 1, background: i < pass.used ? 'var(--rose-light)' : 'var(--rose)' }} />
              ))}
            </div>
            <div className="sub">Общий на всех. Списывается с того, кто пришёл.</div>
          </div>
        )}

        {unpaid.length > 0 && (
          <div className="card-lin">
            <div className="row">
              <div>
                <div className="what">
                  Не оплачено {unpaid.length}&nbsp;{plural(unpaid.length, 'занятие', 'занятия', 'занятий')}
                </div>
                <div className="sub">
                  с {dayMonth(unpaid[0].held_on)} ·{' '}
                  <span style={{ color: 'var(--rose-dark)' }}>{money(debt, unpaid[0].currency)}</span>
                </div>
              </div>
              <Link className="btn" href="/account/pay">Оплатить</Link>
            </div>
          </div>
        )}

        {days.length === 0 ? (
          <p className="hint" style={{ marginTop: 20 }}>На ближайшую неделю занятий нет.</p>
        ) : (
          <BookingHint />
        )}

        {days.length > 0 && (
          days.map((day) => (
            <section key={day}>
              <div className="lbl">{weekdayDayMonth(day)}</div>
              <SlotList rows={slots.filter((s) => s.held_on === day)} />
            </section>
          ))
        )}
      </div>
    </>
  );
}
