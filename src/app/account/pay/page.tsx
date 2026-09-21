import { isAdmin, requireUser } from '@/lib/session';
import {
  PASS_WARN_DAYS, lessonPrice, passBalances, saleOffers, unpaidCharges,
  type PassBalance,
} from '@/lib/studio';
import { isConfigured } from '@/lib/payplus';
import { dayMonth, daysUntil, money, plural, todayISO } from '@/lib/format';
import { STUDIO_TZ } from '@/lib/time';
import { lastTestPayment, myPendingCash, paymentHistory, TEST_AMOUNT, verifyPending } from '@/lib/billing';
import DebtPicker from './DebtPicker';
import { buyPassAction, testPaymentAction } from './actions';

export const dynamic = 'force-dynamic';


export default async function PayPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; cash?: string }>;
}) {
  const user = await requireUser();
  const { error, cash } = await searchParams;
  const online = isConfigured();
  const admin = isAdmin(user);
  // Зависшие платежи доводим до конца сами, не дожидаясь обратного вызова.
  await verifyPending(user.id);
  const lastTest = admin ? await lastTestPayment(user.id) : null;
  const claim = await myPendingCash(user.id);
  const history = await paymentHistory(user.id);
  const mode = process.env.PAYPLUS_ENV === 'prod' ? 'боевая' : 'тестовая';
  const [unpaid, passes, price, offers] = await Promise.all([
    unpaidCharges(user.id),
    passBalances(user.id),
    lessonPrice(),
    saleOffers(),
  ]);
  // Пакет лагеря живёт рядом с обычным абонементом: показываем оба.
  const mine = passes.filter((p) => p.left > 0);
  const hasStudioPass = mine.some((p) => !p.group_id);
  const packs = offers.filter((o) => !o.groupId);
  const events = [...new Map(
    offers.filter((o) => o.groupId).map((o) => [o.groupId!, o]),
  ).keys()].map((gid) => ({
    id: gid,
    title: offers.find((o) => o.groupId === gid)!.groupTitle!,
    validTo: offers.find((o) => o.groupId === gid)!.validTo,
    offers: offers.filter((o) => o.groupId === gid),
  }));

  /** Полоска занятий и предупреждение о сроке: одинаково для всех пакетов. */
  function PassCard({ p }: { p: PassBalance }) {
    const ends = p.valid_to ? daysUntil(p.valid_to, todayISO()) : null;
    const soon = ends !== null && ends <= PASS_WARN_DAYS;
    const what = p.group_id
      ? plural(p.left, 'день', 'дня', 'дней')
      : plural(p.left, 'занятие', 'занятия', 'занятий');
    return (
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
          <div className="what">{p.group_title ?? 'Абонемент'}</div>
          <div style={{ fontSize: 13, color: 'var(--warm-gray)' }}>
            осталось {p.left} из {p.lessons_total}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 4, marginBottom: 10 }}>
          {Array.from({ length: p.lessons_total }, (_, i) => (
            <div key={i} style={{ height: 6, flexGrow: 1, background: i < p.used ? 'var(--rose-light)' : 'var(--rose)' }} />
          ))}
        </div>
        <div className="sub">
          {p.group_id ? 'Только на эти дни' : 'Общий на всех'}
          {p.valid_to ? ` · действует до ${dayMonth(p.valid_to)}` : ''}
        </div>
        {soon && (
          <div className="money-due" style={{ marginTop: 10 }}>
            {ends! > 0
              ? `Осталось ${ends} ${plural(ends!, 'день', 'дня', 'дней')} и ${p.left} ${what}. Неиспользованные сгорят.`
              : `Сегодня последний день: ${p.left} ${what} ещё не использовано.`}
          </div>
        )}
      </div>
    );
  }

  return (
    <>
      <div className="top">
        <div className="kicker">Re.Create.Art · Студия</div>
        <h1 className="h1">Оплата</h1>
      </div>

      <div className="body">
        {error && <p className="err">{error}</p>}

        {mine.map((p) => <PassCard key={p.id} p={p} />)}

        <div className="lbl">{hasStudioPass ? 'Продлить абонемент' : 'Абонемент'}</div>
        <p className="hint" style={{ marginBottom: 16 }}>
          Пакет занятий общий на всю семью: тратится и на детей, и на взрослого.
          Пока он действует, его можно использовать для оплаты любого занятия.
        </p>

        {online ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {packs.map((t) => (
              <form action={buyPassAction} key={t.lessons}>
                <input type="hidden" name="offer" value={`:${t.lessons}`} />
                <button className="btn-quiet" type="submit" style={{ width: '100%', justifyContent: 'space-between' }}>
                  <span>
                    {t.lessons}&nbsp;{plural(t.lessons, 'занятие', 'занятия', 'занятий')}
                    <span className="hint">
                      {' · на '}{t.months}&nbsp;{plural(t.months, 'месяц', 'месяца', 'месяцев')}
                    </span>
                  </span>
                  <span>
                    {money(t.price, price.currency)}
                    {t.price < price.amount * t.lessons && (
                      <span className="hint">
                        {' · '}{money(price.amount * t.lessons - t.price, price.currency)} выгоды
                      </span>
                    )}
                  </span>
                </button>
              </form>
            ))}
            <p className="hint">Срок считается со дня покупки.</p>
          </div>
        ) : (
          <div className="note">
            Купить можно у Вари на занятии или написав на{' '}
            <a href="mailto:info@re-create.art">info@re-create.art</a>. Оплата картой
            появится, когда подключим банк.
          </div>
        )}

        {events.map((e) => (
          <section key={e.id}>
            <div className="lbl">{e.title}</div>
            <p className="hint" style={{ marginBottom: 16 }}>
              Пакет дней только на это: обычные занятия им не оплачиваются, и
              наоборот. Неиспользованные дни сгорают вместе с лагерем
              {e.validTo ? `: ${dayMonth(e.validTo)} — последний день` : ''}.
            </p>
            {online ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {e.offers.map((t) => (
                  <form action={buyPassAction} key={t.lessons}>
                    <input type="hidden" name="offer" value={`${e.id}:${t.lessons}`} />
                    <button className="btn-quiet" type="submit"
                            style={{ width: '100%', justifyContent: 'space-between' }}>
                      <span>{t.lessons}&nbsp;{plural(t.lessons, 'день', 'дня', 'дней')}</span>
                      <span>{money(t.price, price.currency)}</span>
                    </button>
                  </form>
                ))}
              </div>
            ) : (
              <div className="note">Пакет можно купить у Вари.</div>
            )}
          </section>
        ))}

        <div className="lbl">Неоплаченные разовые занятия</div>

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
            Сейчас всё оплачено. Занятия, которые не покроет абонемент, появятся
            здесь. Одно занятие стоит {money(price.amount, price.currency)}.
          </p>
        ) : (
          <DebtPicker charges={unpaid} online={online} />
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
              const what = h.purpose === 'studio_pass'
                  ? (h.group_title ?? 'абонемент')
                : h.purpose === 'studio_test' ? 'проверочный платёж'
                : `занятия${h.lessons ? `, ${h.lessons}` : ''}`;
              const how = h.provider === 'cash' ? 'наличными или переводом' : 'картой';
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
                      {h.invoice_url && (
                        <div className="sub" style={{ marginTop: 4 }}>
                          <a href={h.invoice_url} target="_blank" rel="noreferrer">Квитанция</a>
                        </div>
                      )}
                    </div>
                    <div className="sum" style={{ opacity: h.status === 'paid' ? 1 : 0.6 }}>
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
