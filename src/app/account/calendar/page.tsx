import Link from 'next/link';
import { requireUser } from '@/lib/session';
import { sessionsForUser } from '@/lib/studio';
import { hhmm, todayISO, weekdayDayMonth } from '@/lib/format';
import { toggleBooking } from '../actions';

export const dynamic = 'force-dynamic';

const MONTHS = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];

function monthBounds(month: string): { first: string; last: string; days: number; lead: number } {
  const [y, m] = month.split('-').map(Number);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const firstDow = new Date(Date.UTC(y, m - 1, 1)).getUTCDay(); // 0 = вс
  const lead = (firstDow + 6) % 7; // сетка с понедельника
  const pad = (n: number) => String(n).padStart(2, '0');
  return { first: `${y}-${pad(m)}-01`, last: `${y}-${pad(m)}-${pad(days)}`, days, lead };
}

function shift(month: string, by: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ m?: string; d?: string }>;
}) {
  const user = await requireUser();
  const params = await searchParams;
  const today = todayISO();
  const month = /^\d{4}-\d{2}$/.test(params.m ?? '') ? params.m! : today.slice(0, 7);
  const { first, last, days, lead } = monthBounds(month);

  const rows = await sessionsForUser(user.id, first, last);
  const withSessions = new Set(rows.map((r) => r.held_on));

  const selected = params.d && withSessions.has(params.d)
    ? params.d
    : [...withSessions].sort().find((d) => d >= today) ?? [...withSessions].sort().pop() ?? null;
  const dayRows = rows.filter((r) => r.held_on === selected);

  const pad = (n: number) => String(n).padStart(2, '0');

  return (
    <>
      <div className="top">
        <div className="kicker">Re.Create.Art · Студия</div>
        <div className="row">
          <h1 className="h1">{MONTHS[Number(month.slice(5)) - 1]}</h1>
          <div style={{ display: 'flex', gap: 4 }}>
            <Link className="btn-quiet" href={`/account/calendar?m=${shift(month, -1)}`} aria-label="Предыдущий месяц">←</Link>
            <Link className="btn-quiet" href={`/account/calendar?m=${shift(month, 1)}`} aria-label="Следующий месяц">→</Link>
          </div>
        </div>
      </div>

      <div className="body">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 2, marginBottom: 8 }}>
          {['пн','вт','ср','чт','пт','сб','вс'].map((d) => (
            <div key={d} style={{ textAlign: 'center', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--warm-gray)' }}>{d}</div>
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 2 }}>
          {Array.from({ length: lead }, (_, i) => <div key={`lead-${i}`} />)}
          {Array.from({ length: days }, (_, i) => {
            const iso = `${month}-${pad(i + 1)}`;
            const has = withSessions.has(iso);
            const isSel = iso === selected;
            const cell = (
              <div style={{
                aspectRatio: '1', display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center', gap: 4, fontSize: 14,
                background: isSel ? 'var(--rose)' : 'transparent',
                color: isSel ? '#fff' : has ? 'var(--charcoal)' : 'rgba(26,26,46,0.35)',
              }}>
                {i + 1}
                {has && <div style={{ width: 4, height: 4, borderRadius: '50%', background: isSel ? '#fff' : 'var(--rose)' }} />}
              </div>
            );
            return has
              ? <Link key={iso} href={`/account/calendar?m=${month}&d=${iso}`}>{cell}</Link>
              : <div key={iso}>{cell}</div>;
          })}
        </div>

        {selected ? (
          <section>
            <div className="lbl">{weekdayDayMonth(selected)}</div>
            {dayRows.map((row) => (
              <div className="card" key={`${row.session_id}-${row.participant_id}`}>
                <div className="row">
                  <div>
                    <div className="when">{hhmm(row.starts_at)} · {row.group_title}</div>
                    <div className="what">{row.who}</div>
                    <div className="sub">{row.booked ? 'Место закреплено' : 'Пока без записи'}</div>
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
        ) : (
          <p className="hint" style={{ marginTop: 20 }}>В этом месяце занятий нет.</p>
        )}
      </div>
    </>
  );
}
