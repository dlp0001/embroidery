import { requireUser } from '@/lib/session';
import { lessonPrice, passBalances, unpaidCharges } from '@/lib/studio';
import { dayMonth, money, plural } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function PayPage() {
  const user = await requireUser();
  const [unpaid, passes, price] = await Promise.all([
    unpaidCharges(user.id),
    passBalances(user.id),
    lessonPrice(),
  ]);
  const total = unpaid.reduce((s, c) => s + Number(c.amount), 0);
  const currency = unpaid[0]?.currency ?? price.currency;
  const pass = passes.find((p) => p.left > 0) ?? null;

  return (
    <>
      <div className="top">
        <div className="kicker">Re.Create.Art · Студия</div>
        <h1 className="h1">Оплата</h1>
      </div>

      <div className="body">
        {pass && (
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
              <div className="what">Абонемент</div>
              <div style={{ fontSize: 13, color: 'var(--warm-gray)' }}>
                осталось {pass.left} из {pass.lessons_total}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 4, marginBottom: 10 }}>
              {Array.from({ length: pass.lessons_total }, (_, i) => (
                <div key={i} style={{ height: 6, flexGrow: 1, background: i < pass.used ? 'var(--rose-light)' : 'var(--rose)' }} />
              ))}
            </div>
            <div className="sub">
              Общий на всех{pass.valid_to ? ` · действует до ${dayMonth(pass.valid_to)}` : ''}
            </div>
          </div>
        )}

        <div className="lbl">Не покрыто абонементом</div>

        {unpaid.length === 0 ? (
          <p className="hint">
            Всё оплачено. Занятия, которые не покроет абонемент, появятся здесь.
          </p>
        ) : (
          <>
            {unpaid.map((c) => (
              <div className="card" key={c.id}>
                <div className="row">
                  <div>
                    <div className="when">{dayMonth(c.held_on)} · {c.group_title}</div>
                    <div className="what">{c.who}</div>
                  </div>
                  <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 21 }}>
                    {money(c.amount, c.currency)}
                  </div>
                </div>
              </div>
            ))}

            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
              padding: '20px 2px 22px', borderTop: '1px solid var(--line)', marginTop: 12,
            }}>
              <div style={{ fontSize: 12, letterSpacing: '0.2em', textTransform: 'uppercase', color: 'var(--warm-gray)' }}>
                Итого за {unpaid.length}&nbsp;{plural(unpaid.length, 'занятие', 'занятия', 'занятий')}
              </div>
              <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 34 }}>
                {money(total, currency)}
              </div>
            </div>

            <button className="btn-wide" disabled title="Оплата картой ещё не подключена">
              Оплатить картой
            </button>
            <p className="hint" style={{ marginTop: 14 }}>
              Оплата картой скоро появится. Пока рассчитаться можно на занятии,
              наличными или переводом — Варя отметит это здесь.
            </p>
          </>
        )}

        <div className="note" style={{ marginTop: 24 }}>
          <strong style={{ color: 'var(--charcoal)', fontWeight: 500 }}>
            {pass ? 'Продлить абонемент' : 'Абонемент вместо разовых'}
          </strong>
          <br />
          Пакет занятий общий на всю семью: тратится и на детей, и на взрослого.
          Пока он действует, платить за каждое посещение не нужно. Одно занятие
          стоит {money(price.amount, price.currency)}. Купить можно у Вари на занятии
          или написав на <a href="mailto:info@re-create.art">info@re-create.art</a>.
        </div>
      </div>
    </>
  );
}
