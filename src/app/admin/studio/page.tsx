import Link from 'next/link';
import Journal from '@/components/Journal';
import { isAdmin, requireTeacher } from '@/lib/session';
import {
  debtors, ensureSessions, lessonPrice, nextSessions, sessionRoster, teacherSessions,
  unclosedBefore,
} from '@/lib/studio';
import {
  dayMonth, hhmm, money, plural, plusDays, todayISO, weekdayDayMonth,
} from '@/lib/format';
import { isConfigured as receiptsConfigured } from '@/lib/icount';

export const dynamic = 'force-dynamic';

export default async function TodayPage({
  searchParams,
}: {
  searchParams: Promise<{ d?: string }>;
}) {
  const user = await requireTeacher();
  await ensureSessions();

  // Соседний день открывается стрелками: журнал за вчера закрывают чаще,
  // чем ищут его в календаре, да и завтрашний список полезно увидеть.
  const params = await searchParams;
  const now = todayISO();
  const asked = /^\d{4}-\d{2}-\d{2}$/.test(params.d ?? '') ? params.d! : null;
  const day = asked ?? now;
  const isNow = day === now;

  const scope = isAdmin(user) ? null : user.id;
  const [daySessions, missed, debts, price] = await Promise.all([
    // Сегодняшний день берём у базы: она знает время студии точнее.
    teacherSessions(scope, isNow ? null : day),
    unclosedBefore(scope),
    debtors(),
    lessonPrice(),
  ]);

  // Если сегодня занятий нет, показываем ближайшее — тоже с журналом.
  // На выбранный стрелками день не подменяем: спрашивали именно про него.
  const upcoming = isNow && daySessions.length === 0 ? await nextSessions(scope) : [];
  const today = daySessions.length > 0 ? daySessions : upcoming;
  /** Показываем не тот день, о котором спросили: сегодня пусто. */
  const fallback = isNow && daySessions.length === 0 && upcoming.length > 0;

  const rosters = await Promise.all(today.map((s) => sessionRoster(s.session_id)));
  // Без iCount чек попросить не у кого: тогда и выбора в журнале нет.
  const receipts = receiptsConfigured();
  const debtTotal = debts.reduce((s, d) => s + Number(d.amount), 0);

  return (
    <>
      <div className="top">
        <div className="kicker">Re.Create.Art · Преподаватель</div>
        <div className="row">
          <h1 className="h1">{weekdayDayMonth(day)}</h1>
          <div style={{ display: 'flex', gap: 4 }}>
            <Link className="btn-quiet" href={`/admin/studio?d=${plusDays(day, -1)}`}
                  aria-label="Предыдущий день">←</Link>
            <Link className="btn-quiet" href={`/admin/studio?d=${plusDays(day, 1)}`}
                  aria-label="Следующий день">→</Link>
          </div>
        </div>
        {/* Из чужого дня надо уметь вернуться одним движением: стрелками
            легко уехать на неделю и считать, что сегодня пусто. */}
        {!isNow && (
          <Link className="linky" href="/admin/studio">Сегодня</Link>
        )}
      </div>

      <div className="body">
        {today.length === 0 && (
          <p className="hint" style={{ marginTop: 12 }}>
            {isNow ? 'Занятий нет ни сегодня, ни впереди.' : 'В этот день занятий нет.'}
          </p>
        )}

        {fallback && (
          <div className="lbl" style={{ marginTop: 0 }}>
            Сегодня занятий нет. Ближайшее: {weekdayDayMonth(today[0].held_on).toLowerCase()}
          </div>
        )}

        {today.map((s, i) => (
          <section className="card" key={s.session_id} style={{ marginBottom: 16 }}>
            <div className="row" style={{ alignItems: 'baseline' }}>
              <div>
                <div className="when" style={{ marginBottom: 2 }}>
                  {fallback
                    ? `${dayMonth(s.held_on)} · ${hhmm(s.starts_at)}`
                    : hhmm(s.starts_at)}
                </div>
                <div className="what">{s.group_title}</div>
              </div>
              {s.marked > 0 && <div className="tag tag-ok">отмечено</div>}
            </div>

            {rosters[i].length === 0 ? (
              <p className="hint" style={{ marginTop: 10 }}>В группе пока никого нет.</p>
            ) : (
              <div style={{ marginTop: 10 }}>
                {/* Цена своя у каждого дня: день лагеря стоит не столько,
                    сколько обычное занятие, и в журнале это та цена, по
                    которой считается долг. */}
                <Journal
                  sessionId={s.session_id}
                  roster={rosters[i]}
                  price={money(Number(s.price ?? price.amount), price.currency)}
                  passWord={s.kind === 'camp' ? 'по пакету' : 'по абонементу'}
                  saved={s.marked > 0}
                  kids={s.audience === 'kids'}
                  receipts={receipts}
                />
              </div>
            )}

          </section>
        ))}

        {missed.length > 0 && (
          <div className="card-lin">
            <div className="what" style={{ marginBottom: 6 }}>
              Не отмечено за прошлые дни: {missed.length}
            </div>
            <div className="sub" style={{ marginBottom: 12 }}>
              Пока журнал не закрыт, деньги за эти занятия не посчитаны.
            </div>
            {missed.slice(0, 5).map((s) => (
              <div className="row" key={s.session_id} style={{ padding: '8px 0' }}>
                <div className="sub">{dayMonth(s.held_on)} · {s.group_title}</div>
                <Link className="btn-quiet" href={`/admin/studio/session/${s.session_id}`}>Открыть</Link>
              </div>
            ))}
          </div>
        )}

        {debts.length > 0 && (
          <div className="card-lin" style={{ marginTop: 6 }}>
            <div className="row">
              <div>
                <div className="what">
                  Долги: {debts.length}&nbsp;{plural(debts.length, 'семья', 'семьи', 'семей')}
                </div>
                <div className="sub">на {money(debtTotal, debts[0].currency)}</div>
              </div>
              <Link className="btn-quiet" href="/admin/studio/debts">Смотреть</Link>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
