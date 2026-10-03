import Link from 'next/link';
import { isAdmin, requireTeacher } from '@/lib/session';
import {
  debtors, lessonPrice, passBalances, passOwners, saleOffers, unpaidCharges,
} from '@/lib/studio';
import { pendingCash } from '@/lib/billing';
import { isConfigured as receiptsConfigured } from '@/lib/icount';
import { dayMonth, money, plural, WAY, WAYS } from '@/lib/format';
import { confirmCashAction, declineCashAction, issuePassAction } from '@/app/admin/schedule-actions';
import TakeCash from './TakeCash';

export const dynamic = 'force-dynamic';

const field: React.CSSProperties = {
  width: '100%', padding: '11px 0', border: 0,
  borderBottom: '1.5px solid rgba(180,160,140,0.4)', background: 'transparent',
  fontSize: 16, outline: 'none',
};
const label: React.CSSProperties = {
  display: 'block', fontSize: 10, letterSpacing: '0.3em',
  textTransform: 'uppercase', color: 'var(--warm-gray)', marginBottom: 6,
};

/**
 * Приём денег. Здесь всё, что делают с родителем у стойки: провести
 * принесённые наличные или перевод, подтвердить обещанное из кабинета,
 * продать абонемент. Наблюдение за деньгами — долги, абонементы, реестр,
 * статистика — живёт на «Финансах»: это другой режим и другое время дня.
 */
export default async function PayPage({
  searchParams,
}: {
  searchParams: Promise<{ who?: string }>;
}) {
  const user = await requireTeacher();
  if (!isAdmin(user)) {
    return (
      <>
        <div className="top">
          <div className="kicker">Re.Create.Art · Деньги</div>
          <h1 className="h1">Оплаты</h1>
        </div>
        <div className="body">
          <p className="hint">Деньги принимает студия. Журнал и занятия — на других закладках.</p>
        </div>
      </>
    );
  }

  const { who } = await searchParams;
  const [rows, claims, owners, packs, price] = await Promise.all([
    debtors(), pendingCash(), passOwners(), saleOffers(), lessonPrice(),
  ]);

  // Выбранная семья: её занятия, заявка и абонементы. Всё это нужно
  // рядом — иначе за занятия возьмут деньги, которые уже заплачены.
  const chosen = who && owners.some((o) => o.id === who) ? who : null;
  const [charges, balances] = chosen
    ? await Promise.all([unpaidCharges(chosen), passBalances(chosen)])
    : [[], []];
  const owner = chosen ? owners.find((o) => o.id === chosen)! : null;
  const claim = chosen ? claims.find((cl) => cl.id && cl.owner_email === owner?.email) : undefined;
  const receipts = receiptsConfigured();
  const currency = price.currency;
  const alive = balances.filter((b) => b.left > 0 && !b.ended);
  /**
   * Дни смены, за которые проще взять пакетную цену. Долг показывает
   * разовые 330 за день, и деньги берут по нему: так за кейтану один раз
   * уже взяли 990 вместо 840, и пришлось отменять чек.
   */
  const cheaper = balances
    .map((b) => {
      if (b.extra_price === null || b.max_days < 1 || !b.group_id) return null;
      const days = charges.filter((c) => c.group_id === b.group_id && !c.declared);
      const take = Math.min(days.length, b.max_days);
      if (take < 1) return null;
      const asIs = days.slice(0, take).reduce((n, c) => n + Number(c.amount), 0);
      return { pass: b, take, asIs, cost: b.extra_price * take };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null && x.cost < x.asIs);

  return (
    <>
      <div className="top">
        <div className="kicker">Re.Create.Art · Деньги</div>
        <div className="row">
          <h1 className="h1">Оплаты</h1>
          <Link className="btn-quiet" href="/admin/studio/debts">Финансы</Link>
        </div>
        <p className="sub">Принять деньги, подтвердить заявку, продать абонемент.</p>
      </div>

      <div className="body">
        {claims.length > 0 && (
          <>
            <div className="lbl" style={{ marginTop: 0 }}>Ждут подтверждения</div>
            {claims.map((cl) => (
              <div className="card-lin" key={cl.id}>
                <div className="what">{cl.owner_name ?? cl.owner_email}</div>
                <div className="sub">
                  {/* Пишем то, что сказал родитель. У старых заявок способа
                      нет: они были до того, как о нём стали спрашивать. */}
                  {cl.declared_way ? WAY[cl.declared_way] : 'наличными или переводом'} за{' '}
                  {cl.lessons}&nbsp;
                  {plural(cl.lessons, 'занятие', 'занятия', 'занятий')} ·{' '}
                  {money(cl.amount, cl.currency)}
                </div>
                {/* Обе кнопки в одной форме: подтверждению нужны поля рядом,
                    а вложить форму в форму нельзя. */}
                <form action={confirmCashAction} style={{ marginTop: 14 }}>
                  <input type="hidden" name="paymentId" value={cl.id} />

                  <div className="field" style={{ marginBottom: 14, maxWidth: 260 }}>
                    <label htmlFor={`how-${cl.id}`}>Чем заплатили</label>
                    {/* «Перевод» у родителя значит и биток, и пейбокс, и
                        банковский перевод, а в чеке это три разные вещи.
                        Поэтому не подставляем ничего: Варя видит, куда
                        деньги пришли, и говорит это сама. Наличные другое
                        дело — их она берёт в руки. */}
                    <select id={`how-${cl.id}`} name="payMethod" required
                            defaultValue={cl.declared_way === 'transfer' ? '' : 'cash'}>
                      <option value="" disabled>— чем именно —</option>
                      {WAYS.map((w) => <option key={w} value={w}>{WAY[w]}</option>)}
                    </select>
                  </div>

                  <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start',
                                  marginBottom: 16, cursor: 'pointer' }}>
                    <input type="checkbox" name="receipt" style={{ width: 20, height: 20, marginTop: 2 }} />
                    <span className="hint">
                      Выписать чек в iCount{receipts ? '' : ' — сейчас не подключён'}
                    </span>
                  </label>

                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button className="btn" type="submit">Деньги получены</button>
                    <button className="btn-quiet" type="submit" formAction={declineCashAction}>
                      Отклонить
                    </button>
                  </div>
                </form>
              </div>
            ))}
          </>
        )}

        <div className="lbl">Принять оплату</div>

        {/* Сначала должники: платят почти всегда они. Остальные — списком
            ниже, на случай, когда деньги несут не за долг. */}
        {!chosen && (
          <>
            {rows.length === 0 && <p className="hint">Долгов нет — принимать нечего.</p>}
            {rows.map((d) => (
              <Link className="card" key={d.owner_id} href={`/admin/studio/pay?who=${d.owner_id}`}
                    style={{ display: 'block' }}>
                <div className="row">
                  <div>
                    <div className="what">{d.name ?? d.email}</div>
                    <div className="sub">
                      {d.who} · {d.lessons}&nbsp;
                      {plural(d.lessons, 'занятие', 'занятия', 'занятий')} с {dayMonth(d.since)}
                    </div>
                  </div>
                  <div className="sum sum-due">{money(d.amount, d.currency)}</div>
                </div>
              </Link>
            ))}

            <form className="card" style={{ borderStyle: 'dashed' }}>
              <label style={label} htmlFor="who">Кто-то другой</label>
              <select style={field} id="who" name="who" defaultValue="">
                <option value="" disabled>— выберите семью —</option>
                {owners.map((o) => (
                  <option key={o.id} value={o.id}>{o.name ?? o.email}</option>
                ))}
              </select>
              <button className="btn-quiet" type="submit" style={{ marginTop: 16 }}>
                Открыть
              </button>
            </form>
          </>
        )}

        {chosen && owner && (
          <div className="card">
            <div className="row" style={{ marginBottom: 14 }}>
              <div className="what">{owner.name ?? owner.email}</div>
              <Link className="chip-money money" href="/admin/studio/pay">другая семья</Link>
            </div>

            {claim && (
              <div className="note" style={{ marginBottom: 14 }}>
                У этой семьи уже есть заявка на {money(claim.amount, claim.currency)} —
                подтвердите её выше, а не проводите те же занятия заново.
              </div>
            )}

            {alive.length > 0 && (
              <div className="note" style={{ marginBottom: 14 }}>
                Есть действующий абонемент:{' '}
                {alive.map((b) => `${b.group_title ?? 'абонемент'} — осталось ${b.left}`).join('; ')}.
                Занятия из него закрываются сами, деньги за них брать не надо.
              </div>
            )}

            {cheaper.map(({ pass, take, asIs, cost }) => (
              <div className="note" key={pass.id} style={{ marginBottom: 14 }}>
                {take} {plural(take, 'день', 'дня', 'дней')} «{pass.group_title}» дешевле
                закрыть пакетом: {money(cost, currency)} вместо {money(asIs, currency)}.
                Это кнопка «Продлить» на карточке пакета, на{' '}
                <Link href="/admin/studio/debts">Финансах</Link>: дни закроются сами,
                и брать за них деньги здесь уже не нужно.
              </div>
            ))}

            {charges.length === 0 ? (
              <p className="hint">Неоплаченных занятий нет.</p>
            ) : (
              <TakeCash ownerId={chosen} charges={charges} receipts={receipts} />
            )}
          </div>
        )}

        <div className="card" style={{ borderStyle: 'dashed', marginTop: 16 }}>
          <div className="what" style={{ marginBottom: 16 }}>Продать абонемент или пакет</div>
          <form action={issuePassAction} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            <div>
              <label style={label} htmlFor="ownerId">Кому</label>
              <select style={field} id="ownerId" name="ownerId" required defaultValue={chosen ?? undefined}>
                {owners.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name ?? o.email}{o.active_left > 0 ? ` · уже есть ${o.active_left}` : ''}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label style={label} htmlFor="offer">Что продаём</label>
              <select style={field} id="offer" name="offer" required>
                {packs.map((t) => (
                  <option key={`${t.groupId ?? ''}:${t.lessons}`}
                          value={`${t.groupId ?? ''}:${t.lessons}`}>
                    {t.groupTitle ? `${t.groupTitle}: ` : ''}
                    {t.lessons}&nbsp;
                    {t.groupId
                      ? plural(t.lessons, 'день', 'дня', 'дней')
                      : plural(t.lessons, 'занятие', 'занятия', 'занятий')}
                    {' · '}{money(t.price, currency)}
                    {' · '}
                    {t.validTo
                      ? `до ${dayMonth(t.validTo)}`
                      : `${t.months} ${plural(t.months, 'месяц', 'месяца', 'месяцев')}`}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label style={label} htmlFor="paid">Оплата</label>
              <select style={field} id="paid" name="paid" defaultValue="cash">
                {WAYS.map((w) => <option key={w} value={w}>{WAY[w]}</option>)}
                <option value="unpaid">пока не оплачен</option>
              </select>
            </div>

            <label style={{ display: 'flex', gap: 10, alignItems: 'center', cursor: 'pointer' }}>
              <input type="checkbox" name="receipt" style={{ width: 20, height: 20 }} />
              <span className="hint">
                Выписать чек в iCount{receipts ? '' : ' — сейчас не подключён'}
              </span>
            </label>

            <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', cursor: 'pointer' }}>
              <input type="checkbox" name="coverDebt" style={{ width: 20, height: 20, marginTop: 2 }} />
              <span className="hint">
                Закрыть им уже накопленные неоплаченные занятия, начиная с самых старых.
                Пакет лагеря закрывает только дни этого лагеря
              </span>
            </label>

            <button className="btn-wide" type="submit">Продать</button>
          </form>
          <p className="hint" style={{ marginTop: 14 }}>
            Цена занятия {money(price.amount, price.currency)}. Продление пакета смены
            осталось на «Финансах», на карточке абонемента.
          </p>
        </div>
      </div>
    </>
  );
}
