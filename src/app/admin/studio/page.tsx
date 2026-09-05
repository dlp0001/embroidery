import Link from 'next/link';
import Journal from '@/components/Journal';
import { isAdmin, requireTeacher } from '@/lib/session';
import {
  debtors, ensureSessions, lessonPrice, sessionRoster, teacherSessions, unclosedBefore,
} from '@/lib/studio';
import { dayMonth, hhmm, money, plural, todayISO, weekdayDayMonth } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function TodayPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string }>;
}) {
  const user = await requireTeacher();
  const { saved } = await searchParams;
  await ensureSessions();

  const scope = isAdmin(user) ? null : user.id;
  const [today, missed, debts, price] = await Promise.all([
    teacherSessions(scope),
    unclosedBefore(scope),
    debtors(),
    lessonPrice(),
  ]);

  const rosters = await Promise.all(today.map((s) => sessionRoster(s.session_id)));
  const debtTotal = debts.reduce((s, d) => s + Number(d.amount), 0);
  const priceLabel = money(price.amount, price.currency);

  return (
    <>
      <div className="top">
        <div className="kicker">Re.Create.Art · Преподаватель</div>
        <h1 className="h1">{weekdayDayMonth(todayISO())}</h1>
      </div>

      <div className="body">
        {today.length === 0 && <p className="hint" style={{ marginTop: 12 }}>Сегодня занятий нет.</p>}

        {today.map((s, i) => (
          <section className="card" key={s.session_id} style={{ marginBottom: 16 }}>
            <div className="row" style={{ alignItems: 'baseline' }}>
              <div>
                <div className="when" style={{ marginBottom: 2 }}>{hhmm(s.starts_at)}</div>
                <div className="what">{s.group_title}</div>
              </div>
              {s.marked > 0 && <div className="tag tag-ok">отмечено</div>}
            </div>

            {rosters[i].length === 0 ? (
              <p className="hint" style={{ marginTop: 10 }}>В группе пока никого нет.</p>
            ) : (
              <div style={{ marginTop: 10 }}>
                <Journal
                  sessionId={s.session_id}
                  roster={rosters[i]}
                  price={priceLabel}
                  saved={s.marked > 0}
                />
              </div>
            )}

            {saved === s.session_id && (
              <p className="hint" style={{ marginTop: 12 }}>Сохранено.</p>
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
