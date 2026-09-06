import { isAdmin, requireTeacher } from '@/lib/session';
import { allActivePasses, debtors, lessonPrice, passOwners, passTypes } from '@/lib/studio';
import { pendingCash } from '@/lib/billing';
import { dayMonth, money, plural } from '@/lib/format';
import Link from 'next/link';
import { confirmCashAction, declineCashAction, issuePassAction } from '@/app/admin/schedule-actions';

export const dynamic = 'force-dynamic';

const PAID: Record<string, string> = { cash: 'наличными', transfer: 'переводом' };
const field: React.CSSProperties = {
  width: '100%', padding: '11px 0', border: 0,
  borderBottom: '1.5px solid rgba(180,160,140,0.4)', background: 'transparent',
  fontSize: 16, outline: 'none',
};
const label: React.CSSProperties = {
  display: 'block', fontSize: 10, letterSpacing: '0.3em',
  textTransform: 'uppercase', color: 'var(--warm-gray)', marginBottom: 6,
};

export default async function DebtsPage() {
  const user = await requireTeacher();
  const admin = isAdmin(user);
  const [rows, passes, owners, price, claims, packs] = await Promise.all([
    debtors(),
    allActivePasses(),
    admin ? passOwners() : [],
    lessonPrice(),
    admin ? pendingCash() : [],
    passTypes(),
  ]);
  const currency = price.currency;
  const total = rows.reduce((s, d) => s + Number(d.amount), 0);

  return (
    <>
      <div className="top">
        <div className="kicker">Re.Create.Art · Деньги</div>
        <div className="row">
          <h1 className="h1">Долги</h1>
          {admin && <Link className="btn-quiet" href="/admin/studio/ledger">Реестр</Link>}
        </div>
        {rows.length > 0 && (
          <p className="sub">
            {rows.length}&nbsp;{plural(rows.length, 'семья', 'семьи', 'семей')} на {money(total, rows[0].currency)}
          </p>
        )}
      </div>

      <div className="body">
        {claims.length > 0 && (
          <>
            <div className="lbl" style={{ marginTop: 0 }}>Ждут подтверждения</div>
            {claims.map((cl) => (
              <div className="card-lin" key={cl.id}>
                <div className="what">{cl.owner_name ?? cl.owner_email}</div>
                <div className="sub">
                  наличными за {cl.lessons}&nbsp;
                  {plural(cl.lessons, 'занятие', 'занятия', 'занятий')} ·{' '}
                  {money(cl.amount, cl.currency)}
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                  <form action={confirmCashAction}>
                    <input type="hidden" name="paymentId" value={cl.id} />
                    <button className="btn" type="submit">Деньги получены</button>
                  </form>
                  <form action={declineCashAction}>
                    <input type="hidden" name="paymentId" value={cl.id} />
                    <button className="btn-quiet" type="submit">Отклонить</button>
                  </form>
                </div>
              </div>
            ))}
          </>
        )}

        {rows.length === 0 && <p className="hint">Долгов нет.</p>}
        {rows.map((d) => (
          <div className="card" key={d.owner_id}>
            <div className="row">
              <div>
                <div className="what">{d.name ?? d.email}</div>
                <div className="sub">
                  {d.who} · {d.lessons}&nbsp;{plural(d.lessons, 'занятие', 'занятия', 'занятий')} с {dayMonth(d.since)}
                </div>
              </div>
              <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 21, color: 'var(--rose-dark)' }}>
                {money(d.amount, d.currency)}
              </div>
            </div>
          </div>
        ))}

        <div className="lbl">Действующие абонементы</div>
        {passes.length === 0 && <p className="hint">Ни одного не продано.</p>}
        {passes.map((p) => (
          <div className="card" key={p.id}>
            <div className="row">
              <div>
                <div className="what">{p.owner_name ?? p.owner_email}</div>
                <div className="sub">
                  осталось {p.left} из {p.lessons_total}
                  {p.valid_to ? ` · до ${dayMonth(p.valid_to)}` : ''}
                  {p.paid ? ` · оплачен ${PAID[p.paid] ?? p.paid}` : ' · не оплачен'}
                </div>
              </div>
            </div>
          </div>
        ))}

        {admin && (
          <div className="card" style={{ borderStyle: 'dashed', marginTop: 16 }}>
            <div className="what" style={{ marginBottom: 16 }}>Продать абонемент</div>
            <form action={issuePassAction} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              <div>
                <label style={label} htmlFor="ownerId">Кому</label>
                <select style={field} id="ownerId" name="ownerId" required>
                  {owners.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name ?? o.email}{o.active_left > 0 ? ` · уже есть ${o.active_left}` : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label style={label} htmlFor="lessons">Абонемент</label>
                <select style={field} id="lessons" name="lessons" required>
                  {packs.map((t) => (
                    <option key={t.lessons} value={t.lessons}>
                      {t.lessons} {plural(t.lessons, 'занятие', 'занятия', 'занятий')}
                      {' · '}{money(t.price, currency)}
                      {' · '}{t.months} {plural(t.months, 'месяц', 'месяца', 'месяцев')}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label style={label} htmlFor="paid">Оплата</label>
                <select style={field} id="paid" name="paid" defaultValue="cash">
                  <option value="cash">наличными</option>
                  <option value="transfer">переводом</option>
                  <option value="unpaid">пока не оплачен</option>
                </select>
              </div>

              <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', cursor: 'pointer' }}>
                <input type="checkbox" name="coverDebt" style={{ width: 20, height: 20, marginTop: 2 }} />
                <span className="hint">
                  Закрыть им уже накопленные неоплаченные занятия, начиная с самых старых
                </span>
              </label>

              <button className="btn-wide" type="submit">Продать</button>
            </form>
            <p className="hint" style={{ marginTop: 14 }}>
              Цена занятия {money(price.amount, price.currency)}. Оплата картой появится вместе с PayPlus,
              пока абонемент продаётся здесь, вручную.
            </p>
          </div>
        )}
      </div>
    </>
  );
}
