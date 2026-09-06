import { isAdmin, requireUser } from '@/lib/session';
import { lessonPrice, passBalances, unpaidCharges } from '@/lib/studio';
import { isConfigured } from '@/lib/payplus';
import { dayMonth, money, plural } from '@/lib/format';
import { STUDIO_TZ } from '@/lib/time';
import { lastTestPayment, myPendingCash, paymentHistory, TEST_AMOUNT } from '@/lib/billing';
import DebtPicker from './DebtPicker';
import { buyPassAction, testPaymentAction } from './actions';

export const dynamic = 'force-dynamic';

const PACKS = [4, 8, 12];

export default async function PayPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; cash?: string }>;
}) {
  const user = await requireUser();
  const { error, cash } = await searchParams;
  const online = isConfigured();
  const admin = isAdmin(user);
  const lastTest = admin ? await lastTestPayment(user.id) : null;
  const claim = await myPendingCash(user.id);
  const history = await paymentHistory(user.id);
  const mode = process.env.PAYPLUS_ENV === 'prod' ? 'боевая' : 'тестовая';
  const [unpaid, passes, price] = await Promise.all([
    unpaidCharges(user.id),
    passBalances(user.id),
    lessonPrice(),
  ]);
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

        {cash && (
          <div className="note" style={{ marginBottom: 16 }}>
            Заявка отправлена. Отдайте деньги Варе на занятии — она отметит получение,
            и занятия станут оплаченными.
          </div>
        )}

        {claim && (
          <div className="card-lin">
            <div className="what">Ждёт подтверждения</div>
            <div className="sub">
              Наличными за {claim.lessons}&nbsp;{plural(claim.lessons, 'занятие', 'занятия', 'занятий')} ·{' '}
              {money(claim.amount, claim.currency)}
            </div>
            <p className="hint" style={{ marginTop: 10 }}>
              Пока Варя не отметит получение, занятия числятся неоплаченными.
            </p>
          </div>
        )}

        {unpaid.length === 0 ? (
          <p className="hint">
            Всё оплачено. Занятия, которые не покроет абонемент, появятся здесь.
          </p>
        ) : (
          <DebtPicker charges={unpaid} online={online} />
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
        {history.length > 0 && (
          <>
            <div className="lbl">История платежей</div>
            {history.map((h) => {
              const what = h.purpose === 'studio_pass' ? 'абонемент'
                : h.purpose === 'studio_test' ? 'проверочный платёж'
                : `занятия${h.lessons ? `, ${h.lessons}` : ''}`;
              const how = h.provider === 'cash' ? 'наличными' : 'картой';
              const state = h.status === 'paid'
                ? (h.provider === 'cash' ? 'получены' : 'проведён')
                : h.status === 'pending' ? 'ждёт подтверждения'
                : 'не прошёл';
              return (
                <div className="card" key={h.id}>
                  <div className="row">
                    <div>
                      <div className="when">{whenDay(h.at)}</div>
                      <div className="what">{what}</div>
                      <div className={h.status === 'paid' ? 'sub' : 'money-due'}>
                        {how} · {state}
                      </div>
                    </div>
                    <div style={{
                      fontFamily: "'Cormorant Garamond', serif", fontSize: 20,
                      opacity: h.status === 'paid' ? 1 : 0.6,
                    }}>
                      {money(h.amount, h.currency)}
                    </div>
                  </div>
                </div>
              );
            })}
          </>
        )}
      </div>
    </>
  );
}

function whenDay(iso: string): string {
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: STUDIO_TZ, day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
  }).format(new Date(iso));
}
