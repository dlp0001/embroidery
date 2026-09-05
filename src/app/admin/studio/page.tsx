import Link from 'next/link';
import { isAdmin, requireTeacher } from '@/lib/session';
import { debtors, ensureSessions, teacherSessions } from '@/lib/studio';
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
  const [sessions, debts] = await Promise.all([teacherSessions(scope), debtors()]);
  const today = todayISO();

  // Занятия без учеников отмечать нечего, в список не показываем.
  const open = sessions.filter((s) => s.marked === 0 && s.people > 0);
  const closed = sessions.filter((s) => s.marked > 0);
  const debtTotal = debts.reduce((s, d) => s + Number(d.amount), 0);

  return (
    <>
      <div className="top">
        <div className="kicker">Re.Create.Art · Преподаватель</div>
        <h1 className="h1">{weekdayDayMonth(today)}</h1>
      </div>

      <div className="body">
        {saved && <div className="note" style={{ marginBottom: 16 }}>Журнал сохранён.</div>}

        <div className="lbl">Ждут отметки</div>
        {open.length === 0 && <p className="hint">Всё отмечено.</p>}
        {open.map((s) => (
          <div className={s.held_on === today ? 'card-lin' : 'card'} key={s.session_id}>
            <div className="row">
              <div>
                <div className="when">{dayMonth(s.held_on)} · {hhmm(s.starts_at)}</div>
                <div className="what">{s.group_title}</div>
                <div className="sub">{s.people}&nbsp;{plural(s.people, 'человек', 'человека', 'человек')} · журнал не заполнен</div>
              </div>
              <Link className="btn" href={`/admin/studio/session/${s.session_id}`}>Отметить</Link>
            </div>
          </div>
        ))}

        {closed.length > 0 && <div className="lbl">Закрытые</div>}
        {closed.slice(0, 6).map((s) => (
          <div className="card" key={s.session_id}>
            <div className="row">
              <div>
                <div className="when">{dayMonth(s.held_on)} · {s.group_title}</div>
                <div className="what">Отмечено {s.marked} из {s.people}</div>
              </div>
              <Link className="btn-quiet" href={`/admin/studio/session/${s.session_id}`}>Открыть</Link>
            </div>
          </div>
        ))}

        {debts.length > 0 && (
          <div className="card-lin" style={{ marginTop: 18 }}>
            <div className="row">
              <div>
                <div className="what">Долги: {debts.length}&nbsp;{plural(debts.length, 'семья', 'семьи', 'семей')}</div>
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
