import { requireUser } from '@/lib/session';
import { visitHistory } from '@/lib/studio';
import { dayMonth } from '@/lib/format';

export const dynamic = 'force-dynamic';

const LABEL: Record<string, { text: string; cls: string }> = {
  pass: { text: 'По абонементу', cls: 'tag-ok' },
  paid: { text: 'Оплачено', cls: 'tag-ok' },
  due: { text: 'Не оплачено', cls: 'tag-due' },
  sick: { text: 'Болезнь', cls: 'tag-ok' },
  absent: { text: 'Пропуск', cls: 'tag-ok' },
  trial: { text: 'Пробное', cls: 'tag-ok' },
};

const MONTHS = ['январь','февраль','март','апрель','май','июнь','июль','август','сентябрь','октябрь','ноябрь','декабрь'];

export default async function HistoryPage() {
  const user = await requireUser();
  const rows = await visitHistory(user.id);

  const byMonth = new Map<string, typeof rows>();
  for (const r of rows) {
    const key = r.held_on.slice(0, 7);
    byMonth.set(key, [...(byMonth.get(key) ?? []), r]);
  }

  return (
    <>
      <div className="top">
        <div className="kicker">Re.Create.Art · Студия</div>
        <h1 className="h1">История</h1>
      </div>
      <div className="body">
        {rows.length === 0 && <p className="hint" style={{ marginTop: 20 }}>Занятий пока не было.</p>}
        {[...byMonth.entries()].map(([month, list]) => (
          <section key={month}>
            <div className="lbl">{MONTHS[Number(month.slice(5, 7)) - 1]} {month.slice(0, 4)}</div>
            {list.map((r) => {
              const label = LABEL[r.state] ?? LABEL.due;
              return (
                <div className="card" key={`${r.held_on}-${r.who}-${r.group_title}`}>
                  <div className="row">
                    <div>
                      <div className="when">{dayMonth(r.held_on)} · {r.group_title}</div>
                      <div className="what">{r.who}</div>
                    </div>
                    <div className={`tag ${label.cls}`}>{label.text}</div>
                  </div>
                </div>
              );
            })}
          </section>
        ))}
      </div>
    </>
  );
}
