import Link from 'next/link';
import { isAdmin, requireTeacher } from '@/lib/session';
import { receiptTally, unbilledPayments, type Cell, type Unbilled } from '@/lib/receipts';
import { isConfigured as receiptsConfigured } from '@/lib/icount';
import { dayMonth, money, plural, todayISO, WAY, type PayMethod } from '@/lib/format';
import { issueReceiptsAction } from '@/app/admin/receipt-actions';
import Picker from './Picker';

export const dynamic = 'force-dynamic';
// Квитанции уходят в iCount по одной; страница ждёт ответа, чтобы сказать,
// что вышло, а не «кажется, отправили».
export const maxDuration = 60;

const MONTHS = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
];

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Первый и последний день месяца: «2026-09» → 1 и 30 сентября. */
function bounds(month: string): { from: string; to: string } {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` };
}

/** Предыдущий месяц: «2026-10» → «2026-09». */
function before(month: string): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * С какого месяца открываться. В первые дни нового месяца смотрят ещё на
 * прошлый: бумаги по нему дооформляют, а своих платежей в новом почти
 * нет. Девятое — граница по-живому: к этому сроку прошлый месяц закрыт.
 */
function startMonth(today: string): string {
  const month = today.slice(0, 7);
  return Number(today.slice(8)) <= 9 ? before(month) : month;
}

function title(from: string, to: string): string {
  const month = from.slice(0, 7);
  const whole = bounds(month);
  if (from === whole.from && to === whole.to) {
    return `${MONTHS[Number(month.slice(5)) - 1]} ${month.slice(0, 4)}`;
  }
  if (from === to) return dayMonth(from);
  return `${dayMonth(from)} — ${dayMonth(to)}`;
}

/** Чем заплатили: способ помнит платёж, у старых остаётся провайдер. */
function how(p: Unbilled): string {
  const m = p.pay_method as PayMethod | null;
  if (m) return WAY[m];
  if (p.provider === 'payplus') return 'картой';
  return 'способ не записан';
}

/** За что платёж: занятия, абонемент, пакет смены или докупленные дни. */
function what(p: Unbilled): string {
  if (p.extra_days > 0) {
    return `${p.group_title ? `${p.group_title}: ` : ''}докуплено ${p.extra_days} ${
      plural(p.extra_days, 'день', 'дня', 'дней')}`;
  }
  if (p.purpose === 'studio_pass') {
    return p.group_title
      ? `${p.group_title}: пакет на ${p.lessons} ${plural(p.lessons, 'день', 'дня', 'дней')}`
      : `абонемент на ${p.lessons} ${plural(p.lessons, 'занятие', 'занятия', 'занятий')}`;
  }
  if (p.items) return p.items;
  if (p.lessons > 0) {
    return `${p.lessons} ${plural(p.lessons, 'занятие', 'занятия', 'занятий')}`;
  }
  return 'оплата';
}

/**
 * Квитанции за выбранные дни: сколько бумаг выписано, сколько нет и по
 * каким деньгам. Считается по платежам и по дню платежа — квитанция
 * выписывается на платёж целиком, даже когда он закрыл три занятия.
 */
export default async function ReceiptsPage({
  searchParams,
}: {
  searchParams: Promise<{
    from?: string; to?: string; issue?: string; done?: string; failed?: string;
  }>;
}) {
  const user = await requireTeacher();
  if (!isAdmin(user)) {
    return (
      <>
        <div className="top">
          <div className="kicker">Re.Create.Art · Деньги</div>
          <h1 className="h1">Чеки</h1>
        </div>
        <div className="body"><p className="hint">Раздел доступен админу.</p></div>
      </>
    );
  }

  const params = await searchParams;
  const start = bounds(startMonth(todayISO()));
  const asked = {
    from: DATE.test(params.from ?? '') ? params.from! : start.from,
    to: DATE.test(params.to ?? '') ? params.to! : start.to,
  };
  const from = asked.from <= asked.to ? asked.from : asked.to;
  const to = asked.from <= asked.to ? asked.to : asked.from;
  const issuing = params.issue === '1';
  const done = Number(params.done ?? 0);
  const failed = Number(params.failed ?? 0);

  const [rows, left] = await Promise.all([
    receiptTally(from, to),
    unbilledPayments(from, to),
  ]);
  const icount = receiptsConfigured();

  const sum = (c: Cell[]) => c.reduce((s, x) => s + x.sum, 0);
  const cnt = (c: Cell[]) => c.reduce((s, x) => s + x.count, 0);
  const billed = rows.map((r) => r.billed);
  const missing = rows.map((r) => r.left);
  const currency = 'ILS';

  // Месяцы для переключателя: этот и пять назад. Дальше ходят редко, а
  // руками всегда можно поставить любые даты.
  const months: string[] = [];
  for (let m = todayISO().slice(0, 7), i = 0; i < 6; i++, m = before(m)) months.push(m);

  /** Ячейка: сумма крупно, число платежей под ней мелко. */
  function Money({ c }: { c: Cell }) {
    if (c.count === 0) return <span className="dim">—</span>;
    return (
      <>
        {money(c.sum, currency)}
        <div className="hint rep-cnt">
          {c.count}&nbsp;{plural(c.count, 'платёж', 'платежа', 'платежей')}
        </div>
      </>
    );
  }

  return (
    <>
      <div className="top">
        <div style={{ fontSize: 12, color: 'var(--warm-gray)', marginBottom: 10 }}>
          <Link href="/admin/studio/debts" style={{ color: 'var(--warm-gray)' }}>Деньги</Link> · чеки
        </div>
        <h1 className="h1">{title(from, to)}</h1>
        <p className="sub">Квитанции считаются по дню платежа, а не по дню занятия</p>
      </div>

      <div className="body">
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
          {months.map((m) => {
            const b = bounds(m);
            const on = from === b.from && to === b.to;
            return (
              <Link key={m} href={`/admin/studio/receipts?from=${b.from}&to=${b.to}`}
                    className={`${on ? 'chip-on' : 'chip'} chip-sm`}>
                {MONTHS[Number(m.slice(5)) - 1]}
                {m.slice(0, 4) === todayISO().slice(0, 4) ? '' : ` ${m.slice(0, 4)}`}
              </Link>
            );
          })}
        </div>

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
                <th>Выписан</th>
                <th>Не выписан</th>
                <th>Итого</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.kind}>
                  <td>{r.label}</td>
                  <td><Money c={r.billed} /></td>
                  <td>
                    {r.left.count === 0
                      ? <span className="dim">—</span>
                      : <span className="due">{money(r.left.sum, currency)}</span>}
                    {r.left.count > 0 && (
                      <div className="hint rep-cnt">
                        {r.left.count}&nbsp;{plural(r.left.count, 'платёж', 'платежа', 'платежей')}
                      </div>
                    )}
                  </td>
                  <td>
                    {r.billed.count + r.left.count === 0
                      ? <span className="dim">—</span>
                      : money(r.billed.sum + r.left.sum, currency)}
                  </td>
                </tr>
              ))}
              <tr className="total">
                <td>Итого</td>
                <td>{money(sum(billed), currency)}</td>
                <td>{money(sum(missing), currency)}</td>
                <td>{money(sum(billed) + sum(missing), currency)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <p className="hint" style={{ marginTop: 16 }}>
          По карте квитанция выписывается сама, сразу после оплаты. По
          деньгам, принятым студией, — только если о ней попросили: в
          журнале, в «Оплатах» или отсюда.
        </p>

        {!icount && (
          <p className="note" style={{ marginTop: 16 }}>
            iCount не подключён: выписать отсюда ничего нельзя, таблица
            показывает только то, что уже есть.
          </p>
        )}

        {/* Список прячем за кнопкой: обычно на эту страницу заходят
            посмотреть цифры, а выписывают изредка и нарочно. */}
        {!issuing && left.length > 0 && icount && (
          <div className="card-lin" style={{ marginTop: 18 }}>
            <div className="what" style={{ marginBottom: 6 }}>
              Без квитанции: {left.length}&nbsp;
              {plural(left.length, 'платёж', 'платежа', 'платежей')} на{' '}
              {money(sum(missing), currency)}
            </div>
            <p className="sub" style={{ marginBottom: 14 }}>
              Можно выбрать нужные и выписать бумаги задним числом.
            </p>
            <Link className="btn-quiet"
                  href={`/admin/studio/receipts?from=${from}&to=${to}&issue=1`}>
              Выписать чеки
            </Link>
          </div>
        )}

        {!issuing && left.length === 0 && (
          <p className="hint" style={{ marginTop: 16 }}>
            За эти дни выписаны все {cnt(billed)}&nbsp;
            {plural(cnt(billed), 'квитанция', 'квитанции', 'квитанций')}.
          </p>
        )}

        {/* Что вышло с прошлого нажатия. iCount отвечает по одной
            квитанции, и половина могла пройти, а половина нет. */}
        {(done > 0 || failed > 0) && (
          <p className={failed > 0 ? 'note' : 'hint'} style={{ marginTop: 16 }}>
            {done > 0 && `Выписано ${done}\u00a0${plural(done, 'чек', 'чека', 'чеков')}.`}
            {failed > 0 && ` Не вышло: ${failed}. iCount отказал — можно нажать ещё раз,`
              + ' причина в журнале сервера.'}
          </p>
        )}

        {issuing && (
          <form action={issueReceiptsAction} style={{ marginTop: 18 }}>
            <input type="hidden" name="from" value={from} />
            <input type="hidden" name="to" value={to} />
            <Picker rows={left.map((p) => ({
              id: p.id,
              who: p.who,
              at: dayMonth(p.at.slice(0, 10)),
              what: what(p),
              how: how(p),
              sum: money(p.amount, p.currency),
              declined: p.declined,
            }))} />
          </form>
        )}
      </div>
    </>
  );
}
