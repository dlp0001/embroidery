import Link from 'next/link';
import { isAdmin, requireTeacher } from '@/lib/session';
import {
  allGroups, bookableChildren, bookedInSessions, ensureSessions, sessionsInRange,
  type CalendarSession,
} from '@/lib/studio';
import { hhmm, todayISO, weekdayDayMonth } from '@/lib/format';
import BookChild from '@/components/BookChild';
import BookedList from '@/components/BookedList';
import SessionTime from '@/components/SessionTime';
import {
  addSessionAction, bookChildAction, setSessionStatusAction, setSessionTimeAction,
  unbookChildAction,
} from '@/app/admin/schedule-actions';

export const dynamic = 'force-dynamic';

const MONTHS = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
const pad = (n: number) => String(n).padStart(2, '0');

function bounds(month: string) {
  const [y, m] = month.split('-').map(Number);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  // Неделя с воскресенья: так живёт Израиль и так же выложен календарь
  // в кабинете у родителей.
  const lead = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  return { first: `${month}-01`, last: `${month}-${pad(days)}`, days, lead };
}

/**
 * Цвет точки под числом. У лагеря и мастер-класса он свой: в месяце сразу
 * видно, где идёт смена, а где обычные занятия.
 */
function dot(isEvent: boolean, selected: boolean): string {
  if (selected) return isEvent ? 'rgba(255,255,255,0.55)' : '#fff';
  return isEvent ? 'var(--charcoal)' : 'var(--rose)';
}

function shift(month: string, by: number) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
}

/**
 * Строчка под названием занятия. Пока журнал не заполнен, интересно, кто
 * придёт: записавшиеся отдельно от тех, кого ждём по дням недели. Когда
 * журнал закрыт, интересно уже другое — сколько человек дошло.
 */
function note(s: CalendarSession): string {
  if (s.status === 'cancelled') return 'отменено';
  if (s.marked > 0) {
    if (s.expected === 0) return `пришли ${s.came}`;
    // Пришло больше, чем ждали: «11 из 6» выглядит как ошибка, хотя это правда.
    return s.came > s.expected
      ? `пришли ${s.came}, ждали ${s.expected}`
      : `пришли ${s.came} из ${s.expected}`;
  }
  const rest = Math.max(0, s.expected - s.booked);
  if (s.booked > 0 && rest > 0) return `${s.booked} записано, ещё ожидаем ${rest}`;
  if (s.booked > 0) return `${s.booked} записано`;
  if (rest > 0) return `ждём ${rest}, записи пока нет`;
  return 'журнал пуст';
}

/**
 * Прошедшее занятие, в журнале которого уже есть отметки, отменять нельзя:
 * деньги по нему посчитаны, и «отменено» рядом с начисленным долгом было бы
 * не отменой, а расхождением.
 */
function locked(s: CalendarSession, today: string): boolean {
  return s.held_on < today && s.marked > 0;
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

  const [sessions, groups, kids] = await Promise.all([
    sessionsInRange(first, last), allGroups(), admin ? bookableChildren() : Promise.resolve([]),
  ]);
  const selected = /^\d{4}-\d{2}-\d{2}$/.test(params.d ?? '') ? params.d! : today;
  const daySessions = sessions.filter((s) => s.held_on === selected);
  // Кто записан — только на выбранный день: на весь месяц это был бы
  // тяжёлый запрос ради строчки под одной карточкой.
  const booked = await bookedInSessions(daySessions.map((s) => s.session_id));
  const byDay = new Map<string, boolean[]>();
  for (const s of sessions) {
    if (s.status === 'cancelled') continue;
    byDay.set(s.held_on, [...(byDay.get(s.held_on) ?? []), s.kind !== 'lesson']);
  }

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
          {['вс','пн','вт','ср','чт','пт','сб'].map((d) => (
            <div key={d} style={{ textAlign: 'center', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--warm-gray)' }}>{d}</div>
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 2 }}>
          {Array.from({ length: lead }, (_, i) => <div key={`lead-${i}`} />)}
          {Array.from({ length: days }, (_, i) => {
            const iso = `${month}-${pad(i + 1)}`;
            const kinds = (byDay.get(iso) ?? []).slice(0, 3);
            const count = kinds.length;
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
                    {kinds.map((isEvent, k) => (
                      <div key={k} style={{ width: 4, height: 4, borderRadius: '50%',
                                            background: dot(isEvent, sel) }} />
                    ))}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>

        <div className="lbl day-band">{weekdayDayMonth(selected)}</div>

        {daySessions.length === 0 && <p className="hint">Занятий в этот день нет.</p>}

        {daySessions.map((s) => (
          <div className="card" key={s.session_id} style={{ opacity: s.status === 'cancelled' ? 0.55 : 1 }}>
            <div className="row" style={{ alignItems: 'flex-start' }}>
              <div>
                <SessionTime
                  sessionId={s.session_id}
                  startsAt={s.starts_at}
                  moved={s.moved}
                  action={setSessionTimeAction}
                  canEdit={admin && s.status !== 'cancelled'}
                />
                <div className="what">{s.group_title}</div>
                <div className="sub">{note(s)}</div>
                {/* Имена записанных: видно, кого ждём, и можно снять запись,
                    если родитель отменил её голосом. */}
                {admin && s.status !== 'cancelled' && (
                  <BookedList
                    sessionId={s.session_id}
                    booked={booked.filter((b) => b.session_id === s.session_id)}
                    action={unbookChildAction}
                  />
                )}
              </div>
              {s.status !== 'cancelled' && (
                <Link
                  className={s.marked > 0 ? 'btn-quiet' : 'btn'}
                  href={`/admin/studio/session/${s.session_id}`}
                >
                  {s.marked > 0 ? 'Журнал' : 'Отметить'}
                </Link>
              )}
            </div>

            {admin && (
              <div style={{ display: 'flex', gap: 18, marginTop: 14,
                            alignItems: 'baseline', flexWrap: 'wrap' }}>
                {locked(s, today) ? (
                  <p className="hint" style={{ margin: 0 }}>
                    Занятие прошло и отмечено, отменить его уже нельзя: по нему
                    посчитаны деньги.
                  </p>
                ) : (
                  <form action={setSessionStatusAction}>
                    <input type="hidden" name="id" value={s.session_id} />
                    <input type="hidden" name="status" value={s.status === 'cancelled' ? 'planned' : 'cancelled'} />
                    <button className="linky" type="submit">
                      {s.status === 'cancelled' ? 'Вернуть занятие' : 'Отменить занятие'}
                    </button>
                  </form>
                )}

                {/* Записывают руками, когда родитель договорился голосом.
                    На отменённое и на взрослое занятие ребёнка не пишем. */}
                {s.status !== 'cancelled' && s.audience === 'kids' && (
                  <BookChild sessionId={s.session_id} children={kids} action={bookChildAction} />
                )}
              </div>
            )}
          </div>
        ))}

        {admin && (
          /* Блок разовый и редкий: занимать им пол-экрана незачем. Поэтому
             список и кнопка стоят в одну строку, а не широкой колонкой. */
          <div className="card" style={{ borderStyle: 'dashed', marginTop: 16 }}>
            <div className="lbl" style={{ margin: '0 0 10px' }}>Добавить занятие</div>
            <form action={addSessionAction}
                  style={{ display: 'flex', gap: 12, alignItems: 'center',
                           justifyContent: 'space-between', flexWrap: 'wrap' }}>
              <input type="hidden" name="heldOn" value={selected} />
              <select name="groupId" defaultValue={groups[0]?.id}
                      aria-label="Какую группу добавить"
                      style={{ flex: '1 1 auto', minWidth: 0, padding: '5px 0',
                               border: 0, borderBottom: '1px solid var(--line)',
                               background: 'transparent', fontFamily: 'inherit', fontSize: 14,
                               outline: 'none' }}>
                {groups.filter((g) => g.active).map((g) => (
                  <option key={g.id} value={g.id}>{g.title} · {hhmm(g.starts_at)}</option>
                ))}
              </select>
              <button className="btn-quiet" type="submit">Добавить</button>
            </form>
            <p className="hint" style={{ marginTop: 12 }}>
              Разовое занятие вне обычного расписания группы. Время берётся у группы.
            </p>
          </div>
        )}
      </div>
    </>
  );
}
