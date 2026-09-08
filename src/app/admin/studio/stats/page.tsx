import Link from 'next/link';
import { isAdmin, requireTeacher } from '@/lib/session';
import { monthStats, monthsWithData, type Cell } from '@/lib/stats';
import { money, plural, todayISO } from '@/lib/format';

export const dynamic = 'force-dynamic';

const MONTHS = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
];

function shift(month: string, by: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function title(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

export default async function StatsPage({
  searchParams,
}: {
  searchParams: Promise<{ m?: string }>;
}) {
  const user = await requireTeacher();
  if (!isAdmin(user)) {
    return (
      <>
        <div className="top">
          <div className="kicker">Re.Create.Art · Деньги</div>
          <h1 className="h1">Статистика</h1>
        </div>
        <div className="body">
          <p className="hint">Этот раздел доступен админу.</p>
        </div>
      </>
    );
  }

  const params = await searchParams;
  const month = /^\d{4}-\d{2}$/.test(params.m ?? '') ? params.m! : todayISO().slice(0, 7);
  const [stats, months] = await Promise.all([monthStats(month), monthsWithData()]);

  const cur = stats.currency;
  const sum = (c: Cell[]) => c.reduce((s, x) => s + x.sum, 0);
  const cnt = (c: Cell[]) => c.reduce((s, x) => s + x.count, 0);

  const paid = stats.rows.filter((r) => r.key !== 'due');
  const gotLessons = sum(paid.map((r) => r.lessons));
  const gotPasses = sum(paid.map((r) => r.passes));
  const dueRow = stats.rows.find((r) => r.key === 'due')!;

  /** Ячейка: сумма крупно, число строк под ней мелко. */
  function Money({ c, what }: { c: Cell; what: 'занятие' | 'абонемент' }) {
    if (c.count === 0) return <span className="dim">—</span>;
    return (
      <>
        {money(c.sum, cur)}
        <div className="hint" style={{ marginTop: 2 }}>
          {c.count}&nbsp;
          {what === 'занятие'
            ? plural(c.count, 'занятие', 'занятия', 'занятий')
            : plural(c.count, 'абонемент', 'абонемента', 'абонементов')}
        </div>
      </>
    );
  }

  return (
    <>
      <div className="top">
        <div className="kicker">Re.Create.Art · Деньги</div>
        <div className="row">
          <h1 className="h1">{title(month)}</h1>
          <div style={{ display: 'flex', gap: 4 }}>
            <Link className="btn-quiet" href={`/admin/studio/stats?m=${shift(month, -1)}`}
                  aria-label="Предыдущий месяц">←</Link>
            <Link className="btn-quiet" href={`/admin/studio/stats?m=${shift(month, 1)}`}
                  aria-label="Следующий месяц">→</Link>
          </div>
        </div>
        <p className="sub">
          Занятие считается в том месяце, когда прошло, абонемент — когда куплен
        </p>
      </div>

      <div className="body">
        <div style={{ overflowX: 'auto' }}>
          <table className="rep">
            <thead>
              <tr>
                <th>Как оплачено</th>
                <th>Разовые</th>
                <th>Абонементы</th>
                <th>Итого</th>
              </tr>
            </thead>
            <tbody>
              {stats.rows.map((r) => (
                <tr key={r.key}>
                  <td><span className={r.key === 'due' ? 'due' : undefined}>{r.label}</span></td>
                  <td><Money c={r.lessons} what="занятие" /></td>
                  <td><Money c={r.passes} what="абонемент" /></td>
                  <td>
                    {r.lessons.count + r.passes.count === 0
                      ? <span className="dim">—</span>
                      : money(r.lessons.sum + r.passes.sum, cur)}
                  </td>
                </tr>
              ))}
              <tr className="total">
                <td>Получено</td>
                <td>{money(gotLessons, cur)}</td>
                <td>{money(gotPasses, cur)}</td>
                <td>{money(gotLessons + gotPasses, cur)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <p className="hint" style={{ marginTop: 22 }}>
          «Получено» — деньги, которые дошли до студии в этом месяце.
          Не оплачено сейчас {money(dueRow.lessons.sum + dueRow.passes.sum, cur)} за{' '}
          {cnt([dueRow.lessons, dueRow.passes])}&nbsp;
          {plural(cnt([dueRow.lessons, dueRow.passes]), 'позицию', 'позиции', 'позиций')}.
        </p>

        <div className="card-lin" style={{ marginTop: 18 }}>
          <div className="what" style={{ marginBottom: 6 }}>Абонементы в этом месяце</div>
          <div className="sub">
            Списано с абонементов: {stats.onPass}&nbsp;
            {plural(stats.onPass, 'занятие', 'занятия', 'занятий')}. Продано в
            абонементах: {stats.passLessons}&nbsp;
            {plural(stats.passLessons, 'занятие', 'занятия', 'занятий')}.
          </div>
          <p className="hint" style={{ marginTop: 10 }}>
            Занятие по абонементу продажей не считается: деньги за него взяли
            раньше, когда абонемент покупали.
          </p>
        </div>

        {months.length > 0 && (
          <>
            <div className="lbl" style={{ marginTop: 26 }}>Месяцы с движением</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {months.map((m) => (
                <Link
                  key={m}
                  href={`/admin/studio/stats?m=${m}`}
                  className={m === month ? 'chip-on' : 'chip'}
                  style={{ textDecoration: 'none' }}
                >
                  {title(m)}
                </Link>
              ))}
            </div>
          </>
        )}

        <p className="hint" style={{ marginTop: 26 }}>
          <Link href="/admin/studio/debts">← К финансам</Link>
        </p>
      </div>
    </>
  );
}
