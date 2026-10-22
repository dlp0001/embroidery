import Link from 'next/link';
import { isAdmin, requireTeacher } from '@/lib/session';
import { payoutPlan, RATES, VAT, type Credit, type Payout } from '@/lib/payouts';
import { isConfigured as payplusConfigured } from '@/lib/payplus';
import { cents, dayMonth, money, plural, weekdayDayMonth } from '@/lib/format';
import { askPlansAction } from '@/app/admin/pay-actions';
import Fold from '@/components/Fold';
import Section from '@/components/Section';

export const dynamic = 'force-dynamic';

const pct = (r: number) => `${(r * 100).toLocaleString('ru-RU')}%`;

/** За какую половину месяца выплата: 2-е — за 1–15, 8-е — за 16-е и до конца. */
function half(due: string): string {
  const [y, m, d] = due.split('-').map(Number);
  // Месяц в Date.UTC с нуля: m - 2 — прошлый месяц, а его нулевое число
  // в текущем (m - 1, 0) — последний день прошлого.
  const at = (month: number, day: number) =>
    new Date(Date.UTC(y, month, day)).toISOString().slice(0, 10);
  return d === 2 ? `1–${dayMonth(at(m - 2, 15))}` : `16–${dayMonth(at(m - 1, 0))}`;
}

/** Строка под именем: когда платили и что в этой выплате от продажи. */
function details(c: Credit): string {
  const bits = [`оплата ${dayMonth(c.saleDay)}`];
  if (c.parts > 1) bits.push(`платёж ${c.part} из ${c.parts}`);
  if (c.kind === 'foreign') bits.push('иностранная карта');
  if (c.kind === 'amex') bits.push('Amex');
  if (c.guessed) bits.push('разбивка неизвестна');
  return bits.join(' · ');
}

function PayoutCard({ p }: { p: Payout }) {
  const fresh = p.credits.filter((c) => c.part === 1).length;
  const tails = p.credits.length - fresh;
  return (
    <div className="card">
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <div>
          <div className="what">{weekdayDayMonth(p.day)}</div>
          <div className="sub">
            за {half(p.due)}
            {p.day !== p.due && ` · ${dayMonth(p.due)} банки закрыты`}
          </div>
          <div className="sub">
            {fresh > 0 && `${fresh} ${plural(fresh, 'продажа', 'продажи', 'продаж')}`}
            {fresh > 0 && tails > 0 && ' и '}
            {tails > 0 && `${tails} ${plural(tails, 'платёж', 'платежа', 'платежей')} рассрочки`}
            {' · '}{cents(p.gross)}, комиссия {cents(p.fee)}
          </div>
        </div>
        <div className="sum">≈&nbsp;{money(p.net)}</div>
      </div>
      <Fold label="Из чего">
        <div style={{ marginTop: 6 }}>
          {p.credits.map((c) => (
            <div key={`${c.saleId}-${c.part}`} className="row"
                 style={{ alignItems: 'flex-start', padding: '8px 0', borderTop: '1px solid var(--line)' }}>
              <div>
                <div style={{ fontSize: 14 }}>
                  {c.who}{c.source === 'course' ? ' · видеокурс' : ''}
                </div>
                <div className="sub">{details(c)}</div>
              </div>
              <div style={{ fontSize: 14, whiteSpace: 'nowrap' }}>{cents(c.amount)}</div>
            </div>
          ))}
        </div>
      </Fold>
    </div>
  );
}

/**
 * Когда Isracard переведёт деньги за оплату картой. Ни PayPlus, ни
 * Isracard этого по API не говорят, поэтому график считается по договору,
 * см. lib/payouts. Прошедшие выплаты стоят здесь же: по ним видно,
 * сходится ли расчёт с выпиской.
 */
export default async function PayoutsPage({
  searchParams,
}: {
  searchParams: Promise<{ asked?: string; failed?: string }>;
}) {
  const user = await requireTeacher();
  if (!isAdmin(user)) {
    return (
      <>
        <div className="top">
          <div className="kicker">Re.Create.Art · Деньги</div>
          <h1 className="h1">Выплаты Isracard</h1>
        </div>
        <div className="body"><p className="hint">Раздел доступен админу.</p></div>
      </>
    );
  }

  const { asked, failed } = await searchParams;
  const plan = await payoutPlan();
  const ahead = plan.upcoming.reduce((s, p) => s + p.net, 0);
  const lost = Number(failed ?? 0);

  return (
    <>
      <div className="top">
        <div style={{ fontSize: 12, color: 'var(--warm-gray)', marginBottom: 10 }}>
          <Link href="/admin/studio/debts" style={{ color: 'var(--warm-gray)' }}>Деньги</Link> · выплаты
        </div>
        <h1 className="h1">Выплаты Isracard</h1>
        <p className="sub">Когда и сколько придёт на счёт за оплату картой</p>
      </div>

      <div className="body">
        {asked !== undefined && (
          <div className="note" style={{ marginBottom: 16 }}>
            PayPlus ответил по {asked}&nbsp;{plural(Number(asked), 'продаже', 'продажам', 'продажам')}.
            {lost > 0 && ` Не нашёл ${lost}: они так и считаются одним платежом.`}
          </div>
        )}

        {plan.unasked > 0 && (
          <div className="card-lin">
            <div className="what" style={{ marginBottom: 6 }}>
              {plan.unasked}&nbsp;{plural(plan.unasked, 'продажа', 'продажи', 'продаж')} без разбивки
            </div>
            <p className="sub" style={{ marginBottom: 14 }}>
              Сайт тогда ещё не записывал рассрочку и тип карты. Пока считаем
              одним платежом с израильской карты.
            </p>
            {payplusConfigured() ? (
              <form action={askPlansAction}>
                <button className="btn-quiet" type="submit">Спросить у PayPlus</button>
              </form>
            ) : (
              <p className="hint">PayPlus здесь не подключён.</p>
            )}
          </div>
        )}

        {plan.upcoming.length === 0 && plan.past.length === 0 && (
          <p className="hint">Оплат картой пока не было.</p>
        )}

        {plan.upcoming.length > 0 && (
          <>
            <div className="lbl" style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Впереди</span>
              <span>≈&nbsp;{money(ahead)}</span>
            </div>
            {plan.upcoming.map((p) => <PayoutCard key={p.day} p={p} />)}
          </>
        )}

        {plan.past.length > 0 && (
          <Section title="Прошедшие" count={plan.past.length}>
            <p className="hint" style={{ marginBottom: 12 }}>
              Сверьте сумму продаж с выпиской Isracard. Если разошлось на оплату
              14–15-го или последнего дня месяца, значит, PayPlus передаёт продажи
              не так, как здесь предположено.
            </p>
            {plan.past.map((p) => <PayoutCard key={p.day} p={p} />)}
          </Section>
        )}

        <p className="hint" style={{ marginTop: 18 }}>
          Правило из договора с Isracard: принятое с 1-го по 15-е приходит 2-го
          числа следующего месяца, принятое с 16-го до конца месяца — 8-го.
          Рассрочка приходит частями, по платежу в месяц. Продажа считается
          принятой на следующий рабочий день после оплаты: PayPlus передаёт
          продажи пачкой раз в сутки. Поэтому оплата 15-го приходит 8-го, а
          в последний день месяца — 2-го, но уже через месяц. Выплату,
          выпавшую на субботу или праздник, ждём в следующий рабочий день.
        </p>
        <p className="hint">
          Комиссия по договору: {pct(RATES.local)} с израильских карт,{' '}
          {pct(RATES.amex)} с Amex, {pct(RATES.foreign)} с иностранных, и
          НДС {pct(VAT)} сверху. Если тип карты неизвестен, считаем как
          израильскую. Израильские дебетовые карты Isracard переводит за три
          рабочих дня, их здесь от кредитных не отличить. Не видны оплаты,
          проведённые прямо в PayPlus мимо сайта, и возвраты. Точный график по
          уже принятым продажам — в кабинете Isracard, в разделе будущих
          зачислений.
        </p>
      </div>
    </>
  );
}
