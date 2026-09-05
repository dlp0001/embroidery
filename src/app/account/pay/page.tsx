import { requireUser } from '@/lib/session';
import { unpaidCharges } from '@/lib/studio';
import { dayMonth, money } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function PayPage() {
  const user = await requireUser();
  const unpaid = await unpaidCharges(user.id);
  const total = unpaid.reduce((s, c) => s + Number(c.amount), 0);
  const currency = unpaid[0]?.currency ?? 'ILS';

  return (
    <>
      <div className="top">
        <div className="kicker">Re.Create.Art · Студия</div>
        <h1 className="h1">К оплате</h1>
      </div>
      <div className="body">
        {unpaid.length === 0 ? (
          <p className="hint" style={{ marginTop: 20 }}>
            Всё оплачено. Занятия, не покрытые абонементом, появятся здесь.
          </p>
        ) : (
          <>
            <p className="hint" style={{ margin: '8px 0 20px' }}>
              Занятия, которые уже прошли и не покрыты абонементом.
            </p>

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
                Итого
              </div>
              <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 34 }}>
                {money(total, currency)}
              </div>
            </div>

            <button className="btn-wide" disabled title="PayPlus ещё не подключён">
              Оплатить картой
            </button>
            <p className="hint" style={{ marginTop: 16 }}>
              Оплата пойдёт через PayPlus, квитанция придёт на почту. Кнопка выключена,
              пока нет доступов к терминалу.
            </p>
          </>
        )}
      </div>
    </>
  );
}
