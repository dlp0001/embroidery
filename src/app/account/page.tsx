import Link from 'next/link';
import BookingHint from '@/components/BookingHint';
import EventSignup from '@/components/EventSignup';
import SlotList from '@/components/SlotList';
import { requireUser } from '@/lib/session';
import {
  PASS_WARN_DAYS, eventSlotsForUser, passBalances, slotsForUser, unpaidCharges,
} from '@/lib/studio';
import { dayMonth, daysUntil, money, plural, todayISO, weekdayDayMonth } from '@/lib/format';

export const dynamic = 'force-dynamic';

function plusDays(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

export default async function WeekPage() {
  const user = await requireUser();
  const today = todayISO();
  const [passes, unpaid, slots, events] = await Promise.all([
    passBalances(user.id),
    unpaidCharges(user.id),
    slotsForUser(user.id, today, plusDays(today, 7)),
    eventSlotsForUser(user.id),
  ]);

  // Пакет лагеря лежит рядом с обычным абонементом: показываем оба.
  const mine = passes.filter((p) => p.left > 0);
  const debt = unpaid.reduce((sum, c) => sum + Number(c.amount), 0);

  // Дни лагеря показываем отдельно и целиком, а из недели убираем:
  // два раза одно и то же на одном экране только путает.
  const week = slots.filter((s) => s.kind === 'lesson');
  const days = [...new Set(week.map((s) => s.held_on))];

  return (
    <>
      <div className="top">
        <div className="kicker">Re.Create.Art · Студия</div>
        <h1 className="h1">Эта неделя</h1>
      </div>

      <div className="body">
        {mine.map((pass) => {
          const ends = pass.valid_to ? daysUntil(pass.valid_to, today) : null;
          const soon = ends !== null && ends <= PASS_WARN_DAYS;
          const what = pass.group_id
            ? plural(pass.left, 'день', 'дня', 'дней')
            : plural(pass.left, 'занятие', 'занятия', 'занятий');
          return (
            <div className="card" key={pass.id}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
                <div className="what">{pass.group_title ?? 'Абонемент'}</div>
                <div style={{ fontSize: 13, color: 'var(--warm-gray)' }}>
                  осталось {pass.left} из {pass.lessons_total}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 4, marginBottom: 10 }}>
                {Array.from({ length: pass.lessons_total }, (_, i) => (
                  <div key={i} style={{ height: 6, flexGrow: 1, background: i < pass.used ? 'var(--rose-light)' : 'var(--rose)' }} />
                ))}
              </div>
              <div className="sub">
                {pass.group_id
                  ? 'Только на эти дни. Списывается с того, кто пришёл.'
                  : 'Общий на всех. Списывается с того, кто пришёл.'}
              </div>
              {soon && pass.valid_to && (
                <div className="money-due" style={{ marginTop: 10 }}>
                  {ends! > 0
                    ? `Действует до ${dayMonth(pass.valid_to)}: ${ends} ${
                        plural(ends!, 'день', 'дня', 'дней')} и ${pass.left} ${what}. Потом сгорит.`
                    : `Сегодня последний день: ${pass.left} ${what} ещё не использовано.`}
                </div>
              )}
            </div>
          );
        })}

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

        <EventSignup rows={events} />

        {days.length === 0 ? (
          <p className="hint" style={{ marginTop: 20 }}>
            На ближайшую неделю обычных занятий нет.
          </p>
        ) : (
          <BookingHint />
        )}

        {days.length > 0 && (
          days.map((day) => (
            <section key={day}>
              <div className="lbl">{weekdayDayMonth(day)}</div>
              <SlotList rows={week.filter((s) => s.held_on === day)} />
            </section>
          ))
        )}
      </div>
    </>
  );
}
