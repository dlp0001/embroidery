'use client';

import { dayMonth, Fold, money, plural, Row, useMiniapp } from '../parts';

type Credit = {
  who: string;
  course: boolean;
  saleDay: string;
  amount: number;
  part: number;
  parts: number;
  guessed: boolean;
};

type Payout = {
  day: string;
  due: string;
  gross: number;
  fee: number;
  net: number;
  credits: Credit[];
};

type Data = {
  name: string | null;
  upcoming: Payout[];
  past: Payout[];
  unasked: number;
};

/** Месяц и год: «ноябрь 2026» — для подписи столбика. */
function monthOf(iso: string): string {
  const short = ['янв', 'фев', 'мар', 'апр', 'май', 'июн',
    'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
  const [, m, d] = iso.split('-').map(Number);
  return `${d} ${short[m - 1]}`;
}

/**
 * График оставшихся выплат. Столбики нарочно от самой большой выплаты,
 * а не от нуля: смотрят на них, чтобы понять, какой месяц тяжелее, а не
 * чтобы измерить шекели линейкой.
 */
function Chart({ rows }: { rows: Payout[] }) {
  const top = Math.max(...rows.map((r) => r.net), 1);
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 120, marginBottom: 6 }}>
      {rows.map((r) => (
        <div key={r.day} style={{ flex: 1, textAlign: 'center', minWidth: 0 }}>
          <div style={{ fontSize: 10, color: 'var(--warm-gray)', marginBottom: 4 }}>
            {/* Тысячи сокращаем, сотни пишем как есть: «0,2к» никому
                ничего не говорит. */}
            {r.net >= 1000 ? `${Math.round(r.net / 100) / 10}к` : r.net}
          </div>
          <div
            style={{
              height: `${Math.max(4, Math.round((r.net / top) * 76))}px`,
              background: 'var(--rose)',
              opacity: 0.85,
            }}
          />
          <div style={{ fontSize: 10, color: 'var(--warm-gray)', marginTop: 4 }}>
            {monthOf(r.day)}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function Payouts() {
  const { data, error } = useMiniapp<Data>('/api/tg/payouts');

  if (error) return <p className="hint" style={{ padding: 20 }}>{error}</p>;
  if (!data) return <p className="hint" style={{ padding: 20 }}>Считаем…</p>;

  const ahead = data.upcoming.reduce((s, p) => s + p.net, 0);
  const next = data.upcoming[0] ?? null;

  return (
    <div className="app">
      <div className="top">
        <div className="kicker">Re.Create.Art · Деньги</div>
        <h1 className="h1">Isracard</h1>
        <p className="sub">Когда и сколько придёт на счёт за оплату картой</p>
      </div>

      <div className="body">
        {data.upcoming.length === 0 ? (
          <p className="hint">Впереди выплат нет: всё, что приняли картой, уже пришло.</p>
        ) : (
          <>
            <div className="card">
              <div className="row">
                <div className="what">Впереди</div>
                <div className="what">{money(ahead)}</div>
              </div>
              <div className="sub">
                {data.upcoming.length}&nbsp;
                {plural(data.upcoming.length, 'выплата', 'выплаты', 'выплат')}
                {next ? ` · ближайшая ${dayMonth(next.day)}` : ''}
              </div>
              <div style={{ marginTop: 14 }}>
                <Chart rows={data.upcoming} />
              </div>
            </div>

            {data.upcoming.map((p) => (
              <Fold
                key={p.day}
                title={dayMonth(p.day)}
                total={money(p.net)}
                note={`${p.credits.length} ${
                  plural(p.credits.length, 'платёж', 'платежа', 'платежей')
                } · продали на ${money(p.gross)}, комиссия ${money(p.fee)}`}
              >
                {p.credits.map((c, i) => (
                  <Row
                    key={`${c.who}${c.saleDay}${i}`}
                    left={`${c.who}${c.course ? ' · курс' : ''} · ${dayMonth(c.saleDay)}${
                      c.parts > 1 ? ` · платёж ${c.part} из ${c.parts}` : ''}${
                      c.guessed ? ' · без разбивки' : ''}`}
                    right={money(c.amount)}
                  />
                ))}
              </Fold>
            ))}
          </>
        )}

        {data.unasked > 0 && (
          <p className="hint" style={{ marginTop: 14 }}>
            У {data.unasked}&nbsp;{plural(data.unasked, 'продажи', 'продаж', 'продаж')} нет
            разбивки: считаем их одним платежом с израильской карты. Спросить
            PayPlus можно в журнале, раздел «Выплаты».
          </p>
        )}

        {data.past.length > 0 && (
          <>
            <div className="lbl">Прошедшие</div>
            {data.past.map((p) => (
              <Fold
                key={p.day}
                title={dayMonth(p.day)}
                total={money(p.net)}
                note={`${p.credits.length} ${
                  plural(p.credits.length, 'платёж', 'платежа', 'платежей')
                } · сверьте с выпиской`}
              >
                {p.credits.map((c, i) => (
                  <Row
                    key={`${c.who}${c.saleDay}${i}`}
                    left={`${c.who}${c.course ? ' · курс' : ''} · ${dayMonth(c.saleDay)}`}
                    right={money(c.amount)}
                  />
                ))}
              </Fold>
            ))}
          </>
        )}

        <p className="hint" style={{ marginTop: 18 }}>
          График посчитан по договору: принятое с 1-го по 15-е приходит 2-го
          числа следующего месяца, с 16-го и до конца месяца — 8-го, рассрочка
          частями по месяцам. Из каждой выплаты вычтена комиссия с НДС.
          Выплату, выпавшую на субботу или праздник, ждём в следующий рабочий
          день. Точные числа — в кабинете Isracard, раздел будущих зачислений.
        </p>
      </div>
    </div>
  );
}
