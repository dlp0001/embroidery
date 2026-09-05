import Link from 'next/link';
import { isAdmin, requireTeacher } from '@/lib/session';
import { allGroups, ensureSessions, sessionsInRange } from '@/lib/studio';
import { hhmm, todayISO, weekdayDayMonth } from '@/lib/format';
import {
  addSessionAction, deleteSessionAction, setSessionStatusAction,
} from '@/app/admin/schedule-actions';

export const dynamic = 'force-dynamic';

const MONTHS = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
const pad = (n: number) => String(n).padStart(2, '0');

function bounds(month: string) {
  const [y, m] = month.split('-').map(Number);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const lead = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7;
  return { first: `${month}-01`, last: `${month}-${pad(days)}`, days, lead };
}

function shift(month: string, by: number) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
}

export default async function AdminCalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ m?: string; d?: string }>;
}) {
  const user = await requireTeacher();
  const admin = isAdmin(user);
  const params = await searchParams;
  await ensureSessions();

  const today = todayISO();
  const month = /^\d{4}-\d{2}$/.test(params.m ?? '') ? params.m! : today.slice(0, 7);
  const { first, last, days, lead } = bounds(month);

  const [sessions, groups] = await Promise.all([sessionsInRange(first, last), allGroups()]);
  const selected = /^\d{4}-\d{2}-\d{2}$/.test(params.d ?? '') ? params.d! : today;
  const daySessions = sessions.filter((s) => s.held_on === selected);
  const byDay = new Map<string, number>();
  for (const s of sessions) if (s.status !== 'cancelled') byDay.set(s.held_on, (byDay.get(s.held_on) ?? 0) + 1);

  const href = (d: string) => `/admin/studio/calendar?m=${month}&d=${d}`;

  return (
    <>
      <div className="top">
        <div className="kicker">Re.Create.Art · Расписание</div>
        <div className="row">
          <h1 className="h1">{MONTHS[Number(month.slice(5)) - 1]}</h1>
          <div style={{ display: 'flex', gap: 4 }}>
            <Link className="btn-quiet" href={`/admin/studio/calendar?m=${shift(month, -1)}`} aria-label="Предыдущий месяц">←</Link>
            <Link className="btn-quiet" href={`/admin/studio/calendar?m=${shift(month, 1)}`} aria-label="Следующий месяц">→</Link>
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
            const count = byDay.get(iso) ?? 0;
            const sel = iso === selected;
            return (
              <Link key={iso} href={href(iso)}>
                <div style={{
                  aspectRatio: '1', display: 'flex', flexDirection: 'column',
                  alignItems: 'center', justifyContent: 'center', gap: 3, fontSize: 14,
                  background: sel ? 'var(--rose)' : 'transparent',
                  color: sel ? '#fff' : count ? 'var(--charcoal)' : 'rgba(26,26,46,0.35)',
                  border: iso === today && !sel ? '1px solid var(--rose-light)' : '1px solid transparent',
                }}>
                  {i + 1}
                  <div style={{ display: 'flex', gap: 2 }}>
                    {Array.from({ length: Math.min(count, 3) }, (_, k) => (
                      <div key={k} style={{ width: 4, height: 4, borderRadius: '50%', background: sel ? '#fff' : 'var(--rose)' }} />
                    ))}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>

        <div className="lbl">{weekdayDayMonth(selected)}</div>

        {daySessions.length === 0 && <p className="hint">Занятий в этот день нет.</p>}

        {daySessions.map((s) => (
          <div className="card" key={s.session_id} style={{ opacity: s.status === 'cancelled' ? 0.55 : 1 }}>
            <div className="row" style={{ alignItems: 'flex-start' }}>
              <div>
                <div className="when">{hhmm(s.starts_at)}</div>
                <div className="what">{s.group_title}</div>
                <div className="sub">
                  {s.status === 'cancelled' ? 'отменено' : s.marked > 0 ? `отмечено ${s.marked} из ${s.people}` : `${s.people} в группе, журнал пуст`}
                </div>
              </div>
              {s.marked > 0 && (
                <Link className="btn-quiet" href={`/admin/studio/session/${s.session_id}`}>Журнал</Link>
              )}
            </div>

            {admin && (
              <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
                <form action={setSessionStatusAction}>
                  <input type="hidden" name="id" value={s.session_id} />
                  <input type="hidden" name="status" value={s.status === 'cancelled' ? 'planned' : 'cancelled'} />
                  <button className="btn-quiet" type="submit">
                    {s.status === 'cancelled' ? 'Вернуть' : 'Отменить'}
                  </button>
                </form>
                {s.marked === 0 && (
                  <form action={deleteSessionAction}>
                    <input type="hidden" name="id" value={s.session_id} />
                    <button className="btn-quiet" type="submit">Удалить</button>
                  </form>
                )}
              </div>
            )}
          </div>
        ))}

        {admin && (
          <div className="card" style={{ borderStyle: 'dashed', marginTop: 16 }}>
            <div className="what" style={{ marginBottom: 14 }}>Добавить занятие</div>
            <form action={addSessionAction} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <input type="hidden" name="heldOn" value={selected} />
              <select name="groupId" defaultValue={groups[0]?.id}
                      style={{ width: '100%', padding: '11px 0', border: 0, borderBottom: '1.5px solid rgba(180,160,140,0.4)', background: 'transparent', fontSize: 16, outline: 'none' }}>
                {groups.filter((g) => g.active).map((g) => (
                  <option key={g.id} value={g.id}>{g.title} · {hhmm(g.starts_at)}</option>
                ))}
              </select>
              <button className="btn-wide" type="submit">Добавить на {weekdayDayMonth(selected).toLowerCase()}</button>
            </form>
            <p className="hint" style={{ marginTop: 14 }}>
              Разовое занятие вне обычного расписания группы. Время берётся у группы.
            </p>
          </div>
        )}
      </div>
    </>
  );
}
