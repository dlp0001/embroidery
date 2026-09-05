import { isAdmin, requireUser } from '@/lib/session';
import { lessonPrice, passBalances, unpaidCharges } from '@/lib/studio';
import { isConfigured } from '@/lib/payplus';
import { dayMonth, money, plural } from '@/lib/format';
import { lastTestPayment, TEST_AMOUNT } from '@/lib/billing';
import { buyPassAction, payDebtAction, testPaymentAction } from './actions';

export const dynamic = 'force-dynamic';

const PACKS = [4, 8, 12];

export default async function PayPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await requireUser();
  const { error } = await searchParams;
  const online = isConfigured();
  const admin = isAdmin(user);
  const lastTest = admin ? await lastTestPayment(user.id) : null;
  const mode = process.env.PAYPLUS_ENV === 'prod' ? 'боевая' : 'тестовая';
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
        {error && <p className="err">{error}</p>}

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

            {online ? (
              <form action={payDebtAction}>
                <button className="btn-wide" type="submit">
                  Оплатить {money(total, currency)}
                </button>
              </form>
            ) : (
              <button className="btn-wide" disabled title="Оплата картой ещё не подключена">
                Оплатить картой
              </button>
            )}
            <p className="hint" style={{ marginTop: 14 }}>
              {online
                ? 'Оплата картой на странице банка. Квитанция придёт на почту.'
                : 'Оплата картой скоро появится. Пока рассчитаться можно на занятии, наличными или переводом — Варя отметит это здесь.'}
            </p>
          </>
        )}

        <div className="lbl">{pass ? 'Продлить абонемент' : 'Абонемент'}</div>
        <p className="hint" style={{ marginBottom: 16 }}>
          Пакет занятий общий на всю семью: тратится и на детей, и на взрослого.
          Пока он действует, платить за каждое посещение не нужно.
          Одно занятие стоит {money(price.amount, price.currency)}.
        </p>

        {online ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {PACKS.map((n) => (
              <form action={buyPassAction} key={n}>
                <input type="hidden" name="lessons" value={n} />
                <input type="hidden" name="months" value={3} />
                <button className="btn-quiet" type="submit" style={{ width: '100%', justifyContent: 'space-between' }}>
                  <span>{n}&nbsp;{plural(n, 'занятие', 'занятия', 'занятий')}</span>
                  <span>{money(price.amount * n, price.currency)}</span>
                </button>
              </form>
            ))}
            <p className="hint">Действует три месяца со дня покупки.</p>
          </div>
        ) : (
          <div className="note">
            Купить можно у Вари на занятии или написав на{' '}
            <a href="mailto:info@re-create.art">info@re-create.art</a>. Оплата картой
            появится, когда подключим банк.
          </div>
        )}

        {admin && online && (
          <div className="card" style={{ borderStyle: 'dashed', marginTop: 24 }}>
            <div className="what" style={{ marginBottom: 8 }}>Проверка оплаты</div>
            <p className="hint" style={{ marginBottom: 16 }}>
              Платёж на {TEST_AMOUNT}&nbsp;₪, который ничего не выдаёт. Нужен, чтобы
              убедиться, что деньги доходят и подтверждение возвращается.
              Среда сейчас <strong style={{ color: 'var(--charcoal)' }}>{mode}</strong>
              {mode === 'боевая' ? ' — деньги настоящие, вернуть можно из кабинета PayPlus.' : '.'}
            </p>
            <form action={testPaymentAction}>
              <button className="btn-quiet" type="submit" style={{ width: '100%' }}>
                Провести проверочный платёж
              </button>
            </form>
            {lastTest && (
              <p className="hint" style={{ marginTop: 14 }}>
                Последняя попытка: {money(lastTest.amount, price.currency)} ·{' '}
                {lastTest.status === 'paid'
                  ? 'подтверждение получено, цепочка работает'
                  : lastTest.status === 'pending'
                    ? 'ждём подтверждения от PayPlus'
                    : 'не прошла'}
              </p>
            )}
          </div>
        )}
      </div>
    </>
  );
}
