import Link from 'next/link';
import { isAdmin, requireTeacher } from '@/lib/session';
import { campStats, campsWithData, type Cell } from '@/lib/stats';
import { dayMonth, money, plural } from '@/lib/format';

export const dynamic = 'force-dynamic';

/** Дробное число по-русски: «0,9», а целое — просто «3». */
function num(n: number): string {
  return n.toFixed(1).replace('.0', '').replace('.', ',');
}

/** «3 дня» или «1,3 дня»: у дробного числа слово всегда в родительном. */
function days(n: number): string {
  return Number.isInteger(n) ? plural(n, 'день', 'дня', 'дней') : 'дня';
}

/** "2026-09-22" → "22.09": под столбиком графика длинной даты не поместится. */
function tick(iso: string): string {
  const [, m, d] = iso.split('-');
  return `${d}.${m}`;
}

/**
 * Посещаемость по дням столбиками. Своя разметка, без библиотеки: десять
 * столбиков рисуются двумя десятками строк, а чужой график тянет за собой
 * полмегабайта и свой вкус в цветах.
 */
function Bars({ days, capacity }: {
  days: { held_on: string; came: number; booked: number; past: boolean }[];
  capacity: number | null;
}) {
  const top = Math.max(capacity ?? 0, ...days.map((d) => Math.max(d.came, d.booked)), 1);
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end', overflowX: 'auto',
                  padding: '6px 0 0' }}>
      {days.map((d) => {
        // Прошедший день показываем пришедшими, будущий — записями: иначе
        // пустой столбик завтрашнего дня читается как «никто не пришёл».
        const n = d.past ? d.came : d.booked;
        return (
          <div key={d.held_on} style={{ flex: '1 0 34px', textAlign: 'center' }}>
            <div style={{ fontSize: 12, marginBottom: 4 }}>{n || ''}</div>
            <div style={{ height: 96, display: 'flex', alignItems: 'flex-end' }}>
              <div
                title={`${dayMonth(d.held_on)}: ${n}`}
                style={{
                  width: '100%',
                  height: `${Math.max((n / top) * 96, n > 0 ? 3 : 1)}px`,
                  background: d.past ? 'var(--rose)' : 'var(--rose-light)',
                }}
              />
            </div>
            <div className="hint" style={{ fontSize: 10, marginTop: 6, letterSpacing: 0 }}>
              {tick(d.held_on)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Отчёт по смене целиком. Лагерь живёт на стыке месяцев, и месячная
 * статистика разрезает его пополам — а спрашивают всегда про смену:
 * сколько ходило, сколько заработали, разошлись ли пакеты.
 */
export default async function CampPage({
  searchParams,
}: {
  searchParams: Promise<{ g?: string }>;
}) {
  const user = await requireTeacher();
  if (!isAdmin(user)) {
    return (
      <>
        <div className="top">
          <div className="kicker">Re.Create.Art · Деньги</div>
          <h1 className="h1">Лагерь</h1>
        </div>
        <div className="body">
          <p className="hint">Этот раздел доступен админу.</p>
        </div>
      </>
    );
  }

  const { g } = await searchParams;
  const camps = await campsWithData();
  const chosen = camps.find((c) => c.id === g) ?? camps[0];
  const stats = chosen ? await campStats(chosen.id) : null;

  if (!stats) {
    return (
      <>
        <div className="top">
          <div className="kicker">Re.Create.Art · Деньги</div>
          <h1 className="h1">Лагерь</h1>
        </div>
        <div className="body">
          <p className="hint">
            Смен ещё не было. Лагерь и мастер-класс заводятся в «Группах» на закладке «Админ».
          </p>
        </div>
      </>
    );
  }

  const cur = stats.currency;
  const done = [
    { label: 'Дни поштучно', row: stats.done.single },
    { label: 'Дни по пакетам', row: stats.done.pass },
  ];
  const sum = (c: Cell[]) => c.reduce((s, x) => s + x.sum, 0);
  const allDays = sum(stats.rows.map((r) => r.lessons));
  const allPacks = sum(stats.rows.map((r) => r.passes));
  const dueRow = stats.rows.find((r) => r.key === 'due')!;

  const past = stats.days.filter((d) => d.past);
  const visits = past.reduce((s, d) => s + d.came, 0);
  const perDay = past.length > 0 ? visits / past.length : 0;
  const busiest = [...past].sort((a, b) => b.came - a.came)[0];
  const ahead = stats.days.length - past.length;

  return (
    <>
      <div className="top">
        <div className="kicker">Re.Create.Art · Деньги</div>
        <div className="row">
          <h1 className="h1">{stats.title}</h1>
          <Link className="btn-quiet" href="/admin/studio/debts">Финансы</Link>
        </div>
        <p className="sub">
          {stats.starts_on && stats.ends_on
            ? `${dayMonth(stats.starts_on)} — ${dayMonth(stats.ends_on)}`
            : 'Смена'}
          {' · '}{stats.days.length}&nbsp;{plural(stats.days.length, 'день', 'дня', 'дней')}
          {ahead > 0 ? `, из них ${ahead} впереди` : ''}
        </p>
      </div>

      <div className="body">
        {/* Несколько смен — переключатель. Одна — он только занимает место. */}
        {camps.length > 1 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
            {camps.map((c) => (
              <Link key={c.id} href={`/admin/studio/camp?g=${c.id}`}
                    className={`${c.id === stats.id ? 'chip-on' : 'chip'} chip-sm`}>
                {c.title}
              </Link>
            ))}
          </div>
        )}

        <div className="card">
          <div className="what" style={{ marginBottom: 2 }}>Посещаемость по дням</div>
          <p className="hint" style={{ marginBottom: 10 }}>
            Столбик — сколько детей пришло. Светлые столбики — дни впереди: там
            пока записи, а не отметки.
          </p>
          <Bars days={stats.days} capacity={stats.capacity} />
        </div>

        <div className="row" style={{ gap: 12, flexWrap: 'wrap', margin: '18px 0 6px' }}>
          <div className="card-lin" style={{ flex: '1 1 150px' }}>
            <div className="hint">В среднем за день</div>
            <div className="sum sum-big">{num(perDay)}</div>
            <div className="sub">
              {stats.capacity ? `из ${stats.capacity} мест` : 'без ограничения мест'}
            </div>
          </div>
          <div className="card-lin" style={{ flex: '1 1 150px' }}>
            <div className="hint">Разных детей</div>
            <div className="sum sum-big">{stats.kids}</div>
            <div className="sub">
              по {num(stats.perKid)}&nbsp;{days(stats.perKid)} на каждого
            </div>
          </div>
          <div className="card-lin" style={{ flex: '1 1 150px' }}>
            <div className="hint">День в среднем стоил</div>
            <div className="sum sum-big">{money(Math.round(stats.done.average), cur)}</div>
            <div className="sub">разовый — {money(stats.dayPrice, cur)}</div>
          </div>
        </div>

        {busiest && busiest.came > 0 && (
          <p className="hint" style={{ marginTop: 8 }}>
            Самый людный день — {dayMonth(busiest.held_on)}: {busiest.came}&nbsp;
            {plural(busiest.came, 'ребёнок', 'ребёнка', 'детей')}. Всего посещений {visits}.
          </p>
        )}

        <div className="lbl" style={{ marginTop: 26 }}>Реализация</div>
        <p className="hint" style={{ marginBottom: 14 }}>
          Дни, которые прошли за смену, и сколько они стоят. День по пакету
          считается своей долей от цены пакета, а не ценой разового.
        </p>

        <div style={{ overflowX: 'auto' }}>
          <table className="rep">
            <thead>
              <tr>
                <th>Что прошло</th>
                <th>Дней</th>
                <th>Выручка</th>
              </tr>
            </thead>
            <tbody>
              {done.map((r) => (
                <tr key={r.label}>
                  <td>{r.label}</td>
                  <td>{r.row.count || <span className="dim">—</span>}</td>
                  <td>
                    {r.row.count === 0
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

        <div className="lbl" style={{ marginTop: 26 }}>Как оплачено</div>
        <div style={{ overflowX: 'auto' }}>
          <table className="rep">
            <thead>
              <tr>
                <th>Как оплачено</th>
                <th>Дни</th>
                <th>Пакеты</th>
                <th>Итого</th>
              </tr>
            </thead>
            <tbody>
              {stats.rows.map((r) => (
                <tr key={r.key}>
                  <td><span className={r.key === 'due' ? 'due' : undefined}>{r.label}</span></td>
                  <td>
                    {r.lessons.count === 0
                      ? <span className="dim">—</span>
                      : money(r.lessons.sum, cur)}
                    {r.lessons.count > 0 && (
                      <div className="hint rep-cnt">
                        {r.lessons.count}&nbsp;{plural(r.lessons.count, 'день', 'дня', 'дней')}
                      </div>
                    )}
                  </td>
                  <td>
                    {r.passes.count === 0
                      ? <span className="dim">—</span>
                      : money(r.passes.sum, cur)}
                    {r.passes.count > 0 && (
                      <div className="hint rep-cnt">
                        {r.passes.count}&nbsp;{plural(r.passes.count, 'пакет', 'пакета', 'пакетов')}
                      </div>
                    )}
                  </td>
                  <td>
                    {r.lessons.count + r.passes.count === 0
                      ? <span className="dim">—</span>
                      : money(r.lessons.sum + r.passes.sum, cur)}
                  </td>
                </tr>
              ))}
              <tr className="total">
                <td>Итого</td>
                <td>{money(allDays, cur)}</td>
                <td>{money(allPacks, cur)}</td>
                <td>{money(allDays + allPacks, cur)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <p className="hint" style={{ marginTop: 16 }}>
          Пакеты считаются по дню покупки, дни — по дню, когда прошли.
          {dueRow.lessons.sum + dueRow.passes.sum > 0
            ? ` Не получено ${money(dueRow.lessons.sum + dueRow.passes.sum, cur)}.`
            : ' Всё оплачено.'}
        </p>

        <div className="card-lin" style={{ marginTop: 18 }}>
          <div className="what" style={{ marginBottom: 6 }}>Пакеты смены</div>
          <div className="sub">
            {stats.packs.count === 0
              ? 'Пакетов не продано: все дни оплачивались поштучно.'
              : `Продано ${stats.packs.count} ${
                  plural(stats.packs.count, 'пакет', 'пакета', 'пакетов')} на ${
                  stats.packs.days} ${plural(stats.packs.days, 'день', 'дня', 'дней')} — ${
                  money(stats.packs.sum, cur)}.`}
          </div>
          {stats.extras.count > 0 && (
            <div className="sub" style={{ marginTop: 6 }}>
              Докуплено сверх пакетов: {stats.extras.days}&nbsp;
              {plural(stats.extras.days, 'день', 'дня', 'дней')} на {money(stats.extras.sum, cur)}.
            </div>
          )}
          <p className="hint" style={{ marginTop: 10 }}>
            День по пакету выходит{' '}
            {stats.done.pass.count > 0
              ? money(Math.round(stats.done.pass.sum / stats.done.pass.count), cur)
              : '—'}, разовый — {money(stats.dayPrice, cur)}.
          </p>
        </div>
      </div>
    </>
  );
}
