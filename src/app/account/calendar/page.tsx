import Link from 'next/link';
import { requireUser } from '@/lib/session';
import { slotsForUser } from '@/lib/studio';
import { todayISO, weekdayDayMonth } from '@/lib/format';
import BookingHint from '@/components/BookingHint';
import SlotList from '@/components/SlotList';

export const dynamic = 'force-dynamic';

const MONTHS = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];

function monthBounds(month: string): { first: string; last: string; days: number; lead: number } {
  const [y, m] = month.split('-').map(Number);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  // Неделя начинается с воскресенья: так живёт Израиль, и так же
  // выложена сетка дней лагеря на «Неделе».
  const lead = new Date(Date.UTC(y, m - 1, 1)).getUTCDay(); // 0 = вс
  const pad = (n: number) => String(n).padStart(2, '0');
  return { first: `${y}-${pad(m)}-01`, last: `${y}-${pad(m)}-${pad(days)}`, days, lead };
}

function shift(month: string, by: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * Цвет точки под числом. Лагерь и мастер-класс отличаются от обычного
 * занятия: в календаре это видно раньше, чем человек откроет день.
 */
function dot(isEvent: boolean, selected: boolean): string {
  if (selected) return isEvent ? 'rgba(255,255,255,0.55)' : '#fff';
  return isEvent ? 'var(--charcoal)' : 'var(--rose)';
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

  const rows = await slotsForUser(user.id, first, last);
  // Точек под числом столько, сколько занятий в этот день: в дни лагеря
  // их два — сама смена и обычное занятие после неё.
  // Дни лагеря помечаем своим цветом: в календаре сразу видно, где смена,
  // а где обычное занятие.
  const byDay = new Map<string, Map<string, boolean>>();
  for (const r of rows) {
    const seen = byDay.get(r.held_on) ?? new Map<string, boolean>();
    seen.set(r.session_id, r.kind !== 'lesson');
    byDay.set(r.held_on, seen);
  }
  const withSessions = new Set(byDay.keys());

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
          {['вс','пн','вт','ср','чт','пт','сб'].map((d) => (
            <div key={d} style={{ textAlign: 'center', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--warm-gray)' }}>{d}</div>
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 2 }}>
          {Array.from({ length: lead }, (_, i) => <div key={`lead-${i}`} />)}
          {Array.from({ length: days }, (_, i) => {
            const iso = `${month}-${pad(i + 1)}`;
            const kinds = [...(byDay.get(iso)?.values() ?? [])].slice(0, 3);
            const has = kinds.length > 0;
            const isSel = iso === selected;
            const cell = (
              <div style={{
                aspectRatio: '1', display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center', gap: 4, fontSize: 14,
                background: isSel ? 'var(--rose)' : 'transparent',
                color: isSel ? '#fff' : has ? 'var(--charcoal)' : 'rgba(26,26,46,0.35)',
              }}>
                {i + 1}
                <div style={{ display: 'flex', gap: 2 }}>
                  {kinds.map((isEvent, k) => (
                    <div key={k} style={{ width: 4, height: 4, borderRadius: '50%',
                                          background: dot(isEvent, isSel) }} />
                  ))}
                </div>
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
            <BookingHint />
            <SlotList rows={dayRows} />
          </section>
        ) : (
          <p className="hint" style={{ marginTop: 20 }}>В этом месяце занятий нет.</p>
        )}
      </div>
    </>
  );
}
