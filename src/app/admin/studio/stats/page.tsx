import Link from 'next/link';
import { isAdmin, requireTeacher } from '@/lib/session';
import { periodStats, monthsWithData, type Cell } from '@/lib/stats';
import { dayMonth, money, plural, todayISO } from '@/lib/format';

export const dynamic = 'force-dynamic';

const MONTHS = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
];

/** Первый и последний день месяца: «2026-09» → 1 и 30 сентября. */
function bounds(month: string): { from: string; to: string } {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` };
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Как назвать выбранные дни. Целый месяц — месяцем: «Сентябрь 2026»
 * короче и понятнее, чем «1 — 30 сентября», а на этот отчёт смотрят
 * чаще всего именно помесячно.
 */
function title(from: string, to: string): string {
  const month = from.slice(0, 7);
  const whole = bounds(month);
  if (from === whole.from && to === whole.to) {
    return `${MONTHS[Number(month.slice(5)) - 1]} ${month.slice(0, 4)}`;
  }
  if (from === to) return dayMonth(from);
  return `${dayMonth(from)} — ${dayMonth(to)}`;
}

export default async function StatsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
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
  // Без дат показываем текущий месяц целиком: с него начинают, а дальше
  // уже выбирают свой промежуток.
  const now = bounds(todayISO().slice(0, 7));
  const asked = {
    from: DATE.test(params.from ?? '') ? params.from! : now.from,
    to: DATE.test(params.to ?? '') ? params.to! : now.to,
  };
  // Перепутанные местами даты не повод отказывать: меняем их сами.
  const from = asked.from <= asked.to ? asked.from : asked.to;
  const to = asked.from <= asked.to ? asked.to : asked.from;
  const [stats, months] = await Promise.all([periodStats(from, to), monthsWithData()]);

  const cur = stats.currency;
  // Что студия отработала, по видам. Лагерь появляется в списке только
  // в те месяцы, когда он был.
  const camp = stats.done.event.count > 0 || stats.done.eventPass.count > 0;
  const done = [
    { label: 'Разовые занятия', row: stats.done.single },
    { label: 'По абонементам', row: stats.done.pass },
    ...(camp
      ? [
          { label: 'Дни лагеря', row: stats.done.event },
          { label: 'По пакетам лагеря', row: stats.done.eventPass },
        ]
      : []),
    // Подарки стоят в списке, но не в итоге: их цена — ноль, и в средней
    // они бы только мешали. Строки нет, пока дарить было нечего.
    ...(stats.done.gift.count > 0
      ? [{ label: 'Подарено, вне итога', row: stats.done.gift, free: true }]
      : []),
  ];
  const sum = (c: Cell[]) => c.reduce((s, x) => s + x.sum, 0);
  /** Среднее по нескольким строкам реализации. */
  const mean = (rows: { count: number; sum: number }[]) => {
    const n = rows.reduce((s, r) => s + r.count, 0);
    return n === 0 ? 0 : rows.reduce((s, r) => s + r.sum, 0) / n;
  };
  const cnt = (c: Cell[]) => c.reduce((s, x) => s + x.count, 0);

  // Итог — вся выручка за выбранные дни, вместе с неоплаченным.
  const allLessons = sum(stats.rows.map((r) => r.lessons));
  const allPasses = sum(stats.rows.map((r) => r.passes));
  const dueRow = stats.rows.find((r) => r.key === 'due')!;
  const due = dueRow.lessons.sum + dueRow.passes.sum;

  /** Ячейка: сумма крупно, число строк под ней мелко. */
  function Money({ c, what }: { c: Cell; what: 'занятие' | 'абонемент' }) {
    if (c.count === 0) return <span className="dim">—</span>;
    return (
      <>
        {money(c.sum, cur)}
        <div className="hint rep-cnt">
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
        <h1 className="h1">{title(from, to)}</h1>
        <p className="sub">
          Занятие считается в тот день, когда прошло, абонемент — когда куплен
        </p>
      </div>

      <div className="body">
        {/* Месяцы — кнопками: ими пользуются чаще всего, и выбирать первое
            и последнее число руками ради «сентября» незачем. */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
          {months.slice(0, 12).map((m) => {
            const b = bounds(m);
            const on = from === b.from && to === b.to;
            return (
              <Link key={m} href={`/admin/studio/stats?from=${b.from}&to=${b.to}`}
                    className={`${on ? 'chip-on' : 'chip'} chip-sm`}>
                {MONTHS[Number(m.slice(5)) - 1]}
                {m.slice(0, 4) === todayISO().slice(0, 4) ? '' : ` ${m.slice(0, 4)}`}
              </Link>
            );
          })}
        </div>

        {/* Свой промежуток: обычная форма, без лишних нажатий — выбрал
            даты и нажал «Показать». Адрес остаётся читаемым, им можно
            поделиться или вернуться к нему завтра. */}
        <form className="card" style={{ display: 'flex', gap: 12, flexWrap: 'wrap',
                                        alignItems: 'flex-end', marginBottom: 18 }}>
          <div className="field" style={{ marginBottom: 0, flex: '1 1 140px' }}>
            <label htmlFor="from">С какого дня</label>
            <input id="from" name="from" type="date" defaultValue={from} />
          </div>
          <div className="field" style={{ marginBottom: 0, flex: '1 1 140px' }}>
            <label htmlFor="to">По какой</label>
            <input id="to" name="to" type="date" defaultValue={to} />
          </div>
          <button className="btn-quiet" type="submit">Показать</button>
        </form>

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
                <td>Итого</td>
                <td>{money(allLessons, cur)}</td>
                <td>{money(allPasses, cur)}</td>
                <td>{money(allLessons + allPasses, cur)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <p className="hint" style={{ marginTop: 22 }}>
          «Итого» — вся выручка за эти дни, вместе с тем, что ещё не заплатили.
          Из неё {money(due, cur)} за {cnt([dueRow.lessons, dueRow.passes])}&nbsp;
          {plural(cnt([dueRow.lessons, dueRow.passes]), 'позицию', 'позиции', 'позиций')} пока
          не получено, остальное на руках.
        </p>

        <div className="lbl" style={{ marginTop: 30 }}>Реализация</div>
        <p className="hint" style={{ marginBottom: 14 }}>
          Занятия, которые прошли за эти дни, и сколько они стоят. Занятие
          по абонементу считается своей долей от его цены, а не ценой разового;
          день лагеря — своей долей от цены пакета.
        </p>

        <div style={{ overflowX: 'auto' }}>
          <table className="rep">
            <thead>
              <tr>
                <th>Что прошло</th>
                <th>Занятий</th>
                <th>Выручка</th>
              </tr>
            </thead>
            <tbody>
              {/* Строки лагеря показываем, только когда он был: в обычный
                  месяц два вечных прочерка ничего не объясняют. */}
              {done.map((r) => (
                <tr key={r.label}>
                  <td>{r.label}</td>
                  <td>{r.row.count || <span className="dim">—</span>}</td>
                  <td>
                    {'free' in r || r.row.count === 0
                      ? <span className="dim">—</span>
                      : money(r.row.sum, cur)}
                  </td>
                </tr>
              ))}
              <tr className="total">
                <td>Итого</td>
                <td>{stats.done.total.count}</td>
                <td>{money(stats.done.total.sum, cur)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Среднее по обычным занятиям и по дням лагеря — врозь: сотня
            и триста тридцать в одной средней не значат ничего. */}
        <p className="hint" style={{ marginTop: 16 }}>
          {stats.done.total.count === 0
            ? 'Занятий за эти дни не было.'
            : camp
              ? <>
                  Среднее обычное занятие стоило {money(mean(
                    [stats.done.single, stats.done.pass]), cur)}, день лагеря —{' '}
                  {money(mean([stats.done.event, stats.done.eventPass]), cur)}.
                </>
              : <>Среднее занятие стоило {money(stats.done.average, cur)}.</>}
        </p>

        <div className="card-lin" style={{ marginTop: 18 }}>
          <div className="what" style={{ marginBottom: 6 }}>Абонементы за эти дни</div>
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

        <p className="hint" style={{ marginTop: 26 }}>
          <Link href="/admin/studio/debts">← К финансам</Link>
        </p>
      </div>
    </>
  );
}
