import { isAdmin, requireTeacher } from '@/lib/session';
import {
  PASS_WARN_DAYS, allActivePasses, debtors, lessonPrice, spentPasses, unbilledVisits,
} from '@/lib/studio';
import type { PassRow } from '@/lib/studio';
import { isConfigured as receiptsConfigured } from '@/lib/icount';
import {
  dayMonth, daysUntil, money, plural, todayISO, WAY, WAYS, type PayMethod,
} from '@/lib/format';
import Link from 'next/link';
import { extendPassAction } from '@/app/admin/schedule-actions';
import Section from '@/components/Section';
import ExtendFold from './ExtendFold';

export const dynamic = 'force-dynamic';

/** Чем оплачен абонемент: способ помнит платёж, провайдер знает грубее. */
function paidWith(p: PassRow): string {
  if (!p.paid) return 'не оплачен';
  // «Наличными» и «переводом» — как деньги отдали, «через Bit» — чем.
  const how = p.paid_how as PayMethod | null;
  if (how === 'bit' || how === 'paybox') return `оплачен через ${WAY[how]}`;
  if (how) return `оплачен ${WAY[how]}`;
  return `оплачен ${p.paid === 'cash' ? 'наличными' : p.paid === 'transfer' ? 'переводом' : 'картой'}`;
}
/**
 * Докупить дни в пакет смены. Стоит и у действующего пакета, и у
 * кончившегося: дни в смене ещё идут, а платить за них как за разовые
 * дороже, чем добрать в пакет.
 */
/** Можно ли в этот пакет добавить дни: цена дня задана и запас есть. */
function canExtend(p: PassRow): boolean {
  return p.extra_price !== null && p.max_days > 0;
}

function ExtendForm(
  { pass: p, currency, receipts }:
  { pass: PassRow; currency: string; receipts: boolean },
) {
  return (
    <form action={extendPassAction} style={{
      display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap', marginTop: 12,
    }}>
      <input type="hidden" name="passId" value={p.id} />
      <div className="field" style={{ marginBottom: 0, width: 80 }}>
        <label htmlFor={`ext-${p.id}`}>Дней</label>
        <select id={`ext-${p.id}`} name="days" defaultValue="1">
          {Array.from({ length: Math.min(p.max_days, 10) }, (_, i) => i + 1)
            .map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </div>
      <div className="field" style={{ marginBottom: 0, width: 150 }}>
        <label htmlFor={`extpaid-${p.id}`}>Оплата</label>
        <select id={`extpaid-${p.id}`} name="paid" defaultValue="cash">
          {WAYS.map((w) => <option key={w} value={w}>{WAY[w]}</option>)}
          <option value="unpaid">пока не оплачено</option>
        </select>
      </div>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer' }}>
        <input type="checkbox" name="receipt" style={{ width: 20, height: 20 }} />
        <span className="hint">
          Чек в iCount{receipts ? '' : ' — не подключён'}
        </span>
      </label>
      <button className="btn-quiet" type="submit">
        Продлить · {money(p.extra_price ?? 0, currency)} за день
      </button>
    </form>
  );
}

export default async function DebtsPage() {
  const user = await requireTeacher();
  const admin = isAdmin(user);
  const [rows, passes, price] = await Promise.all([
    debtors(),
    allActivePasses(),
    lessonPrice(),
  ]);
  const spent = await spentPasses();
  const unbilled = await unbilledVisits();
  const receipts = receiptsConfigured();
  // Скоро сгорят: срок на исходе, а занятия ещё остались.
  const today = todayISO();
  const burning = passes.filter(
    (p) => p.valid_to && p.left > 0 && daysUntil(p.valid_to, today) <= PASS_WARN_DAYS,
  );
  const currency = price.currency;
  const total = rows.reduce((s, d) => s + Number(d.amount), 0);
  const lessons = rows.reduce((s, d) => s + d.lessons, 0);
  const since = rows.map((d) => d.since).sort()[0] ?? todayISO();

  return (
    <>
      <div className="top">
        <div className="kicker">Re.Create.Art · Деньги</div>
        <h1 className="h1">Финансы</h1>
        <p className="sub">Долги, абонементы и полученные деньги</p>
      </div>

      <div className="body">
        {unbilled > 0 && (
          <div className="note" style={{ marginBottom: 18 }}>
            {unbilled}&nbsp;{plural(unbilled, 'занятие', 'занятия', 'занятий')} без
            плательщика: у детей нет родителя, и счёт выставить некому. В долги
            они не попадут, пока ребёнка не привяжут.{' '}
            <Link href="/admin/studio/people">Привязать в «Людях»</Link>.
          </div>
        )}

        {/* Соседние денежные страницы: не в шапке, где они теснили
            заголовок, а здесь — перед первой цифрой, которую читают. */}
        {admin && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
            <Link className="btn-quiet" href="/admin/studio/camp">Лагерь</Link>
            <Link className="btn-quiet" href="/admin/studio/stats">Статистика</Link>
            <Link className="btn-quiet" href="/admin/studio/payments">Платежи</Link>
            <Link className="btn-quiet" href="/admin/studio/receipts">Чеки</Link>
          </div>
        )}

        {/* Разбор по семьям живёт на «Оплатах»: там же, где долг и
            закрывают. Здесь нужна одна цифра — сколько всего не дошло. */}
        {rows.length === 0 ? (
          <p className="hint">Долгов нет.</p>
        ) : (
          <div className="card">
            <div className="row">
              <div>
                <div className="what">Не оплачено</div>
                <div className="sub">
                  {rows.length}&nbsp;{plural(rows.length, 'семья', 'семьи', 'семей')} ·{' '}
                  {lessons}&nbsp;{plural(lessons, 'занятие', 'занятия', 'занятий')} с{' '}
                  {dayMonth(since)}
                </div>
              </div>
              <div className="sum sum-due">{money(total, rows[0].currency)}</div>
            </div>
          </div>
        )}

        {burning.length > 0 && (
          <div className="note" style={{ marginBottom: 18 }}>
            {burning.length === 1 ? 'У одной семьи' : `У ${burning.length} семей`} скоро
            кончится абонемент, а занятия в нём остались:{' '}
            {burning.map((p) => `${p.owner_name ?? p.owner_email} — ${p.left} до ${dayMonth(p.valid_to!)}`).join('; ')}.
          </div>
        )}

        <Section title="Действующие абонементы" count={passes.length}>
          {passes.length === 0 && <p className="hint">Ни одного не продано.</p>}
          {passes.map((p) => (
            <div className="card" key={p.id}>
              <div className="row">
                <div>
                  <div className="what">{p.owner_name ?? p.owner_email}</div>
                  <div className="sub">
                    {p.group_title ? `${p.group_title}: ` : ''}
                    осталось {p.left} из {p.lessons_total}
                    {p.valid_to ? ` · до ${dayMonth(p.valid_to)}` : ''}
                    {` · ${paidWith(p)}`}
                  </div>
                </div>
              </div>

              {admin && canExtend(p) && (
                <ExtendFold>
                  <ExtendForm pass={p} currency={currency} receipts={receipts} />
                </ExtendFold>
              )}
            </div>
          ))}
        </Section>

        {/* Только что закончившиеся: в журнале по ним ещё стоит «по
            абонементу», и без этой строки непонятно, чем оплачено. */}
        {spent.length > 0 && (
          <Section title="Закончились" count={spent.length}>
            {spent.map((p) => (
              <div className="card" key={p.id} style={{ opacity: 0.7 }}>
                <div className="what">{p.owner_name ?? p.owner_email}</div>
                <div className="sub">
                  {p.group_title ? `${p.group_title}: ` : ''}
                  все {p.lessons_total} использованы
                  {p.last_used ? ` · последнее ${dayMonth(p.last_used)}` : ''}
                  {` · ${paidWith(p)}`}
                </div>
                {admin && canExtend(p) && (
                  <ExtendFold>
                    <ExtendForm pass={p} currency={currency} receipts={receipts} />
                  </ExtendFold>
                )}
              </div>
            ))}
          </Section>
        )}

        {admin && (
          <div className="card-lin" style={{ marginTop: 16 }}>
            <div className="what" style={{ marginBottom: 6 }}>Принять деньги</div>
            <p className="sub" style={{ marginBottom: 14 }}>
              Наличные и переводы, заявки родителей и продажа абонементов — на
              «Оплатах». Там же видно, кто из семей сколько должен.
            </p>
            <Link className="btn-quiet" href="/admin/studio/pay">Открыть оплаты</Link>
          </div>
        )}
      </div>
    </>
  );
}
