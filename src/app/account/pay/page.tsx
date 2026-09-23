import Link from 'next/link';
import { isAdmin, requireUser } from '@/lib/session';
import {
  PASS_WARN_DAYS, lessonPrice, passBalances, saleOffers, unpaidCharges,
  type PassBalance,
} from '@/lib/studio';
import { isConfigured } from '@/lib/payplus';
import { dayMonth, daysUntil, money, plural, todayISO } from '@/lib/format';
import { STUDIO_TZ } from '@/lib/time';
import {
  lastTestPayment, myPendingCash, paymentHistory, TEST_AMOUNT, unfinishedPayments, verifyPending,
  WAY,
} from '@/lib/billing';
import DebtPicker from './DebtPicker';
import {
  buyPassAction, cancelCashAction, dropPaymentAction, testPaymentAction,
} from './actions';

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
  const mode = process.env.PAYPLUS_ENV === 'prod' ? 'боевая' : 'тестовая';
  // Всё разом, а не по очереди. Дольше всех обычно проверка зависших
  // платежей: она спрашивает про каждый у PayPlus, по сети. Раньше страница
  // ждала сначала её, потом всё остальное, и складывала одно с другим.
  const [check, lastTest, claim, history0, started0, unpaid0, passes0, price, offers] =
    await Promise.all([
    // Зависшие платежи доводим до конца сами, не дожидаясь обратного вызова.
    verifyPending(user.id),
    admin ? lastTestPayment(user.id) : Promise.resolve(null),
    myPendingCash(user.id),
    paymentHistory(user.id),
    unfinishedPayments(user.id),
    unpaidCharges(user.id),
    passBalances(user.id),
    lessonPrice(),
    saleOffers(),
  ]);

  // Проверка могла довести платёж до конца: тогда долги и абонементы,
  // прочитанные с ней заодно, уже устарели и их надо взять заново.
  const [history, unpaid, passes, started] = check.paid > 0
    ? await Promise.all([
        paymentHistory(user.id), unpaidCharges(user.id), passBalances(user.id),
        unfinishedPayments(user.id),
      ])
    : [history0, unpaid0, passes0, started0];
  // Пакет лагеря живёт рядом с обычным абонементом: показываем оба.
  const mine = passes.filter((p) => p.left > 0);
  const hasStudioPass = mine.some((p) => !p.group_id);
  const packs = offers.filter((o) => !o.groupId);
  const events = [...new Map(
    offers.filter((o) => o.groupId).map((o) => [o.groupId!, o]),
  ).keys()].map((gid) => ({
    id: gid,
    title: offers.find((o) => o.groupId === gid)!.groupTitle!,
    kind: offers.find((o) => o.groupId === gid)!.kind,
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

        {/* Долг — первым: за «Оплатой» чаще всего идут именно из-за него,
            а не за новым абонементом. */}
        {unpaid.length === 0 ? (
          <>
            <div className="lbl day-band" style={{ marginTop: 0 }}>Задолженность</div>
            <p className="hint">
              Сейчас всё оплачено. Занятия, которые не покроет абонемент, появятся
              здесь. Одно занятие стоит {money(price.amount, price.currency)}.
            </p>
          </>
        ) : (
          <>
            {/* Сумма стоит внутри полосы, а не рядом: иначе полоса
                обрывается на полуслове, а сумма висит сама по себе. */}
            <div className="lbl day-band" style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
              gap: 12, marginTop: 0,
            }}>
              <span>Задолженность</span>
              <span className="sum" style={{
                fontSize: 21, letterSpacing: 'normal', textTransform: 'none',
              }}>
                {money(unpaid.reduce((n, c) => n + Number(c.amount), 0), unpaid[0].currency)}
              </span>
            </div>
            {/* Ключ по списку долгов: когда он меняется — заявили оплату
                или отменили её — выбор собирается заново, и по умолчанию
                снова отмечено всё. */}
            <DebtPicker key={unpaid.map((c) => `${c.id}${c.declared ? '!' : ''}`).join()}
                        charges={unpaid} online={online} />
          </>
        )}

        {/* Платёж картой, начатый и брошенный: касса у PayPlus ещё жива,
            и продолжить можно с того же места. */}
        {started.map((s) => (
          <div className="card-lin" key={s.id} style={{ marginTop: 16 }}>
            <div className="what">Незавершённый платёж</div>
            <div className="sub">
              {s.purpose === 'studio_pass'
                ? (s.group_title ?? 'абонемент')
                : s.purpose === 'studio_test' ? 'проверочный платёж'
                : `занятия${s.lessons ? `, ${s.lessons}` : ''}`}
              {' · '}{money(s.amount, s.currency)}
            </div>
            <p className="hint" style={{ marginTop: 10 }}>
              Страница банка была открыта, но оплата не завершилась. Можно
              вернуться к ней и доплатить.
            </p>
            <div style={{ display: 'flex', gap: 14, alignItems: 'baseline', marginTop: 10 }}>
              <Link className="btn-quiet" href={`/account/pay/go/${s.id}`}>Продолжить</Link>
              <form action={dropPaymentAction}>
                <input type="hidden" name="id" value={s.id} />
                <button type="submit" className="linky">Отменить</button>
              </form>
            </div>
          </div>
        ))}

        {cash && (
          <div className="note" style={{ marginTop: 16 }}>
            Заявка отправлена. Отдайте деньги Варе на занятии — она отметит получение,
            и занятия станут оплаченными.
          </div>
        )}

        {claim && (
          <div className="card-lin" style={{ marginTop: 16 }}>
            <div className="what">Ждёт подтверждения</div>
            <div className="sub">
              {claim.declared_way === 'transfer' ? 'Переводом' : 'Наличными'} за{' '}
              {claim.lessons}&nbsp;{plural(claim.lessons, 'занятие', 'занятия', 'занятий')} ·{' '}
              {money(claim.amount, claim.currency)}
            </div>
            <p className="hint" style={{ marginTop: 10 }}>
              Пока Варя не отметит получение, занятия числятся неоплаченными.
            </p>
            {/* Передумать можно: занятия вернутся в список неоплаченных,
                и их снова можно будет выбрать. */}
            <form action={cancelCashAction} style={{ marginTop: 10 }}>
              <button type="submit" className="linky">Отменить платёж</button>
            </form>
          </div>
        )}

        {/* Всё про абонементы под одним заголовком: что есть, что можно
            купить в смену и как продлить обычный. */}
        <div className="lbl day-band">Абонементы и пакеты</div>

        {mine.length > 0 && (
          <>
            <div className="lbl" style={{ marginTop: 0 }}>Что уже куплено</div>
            {mine.map((p) => <PassCard key={p.id} p={p} />)}
          </>
        )}

        {/* Пакет лагеря — отдельная покупка, не «ещё один абонемент».
            Поэтому он живёт в своей рамке, а не в общем списке. */}
        {events.map((e) => (
          <div className="card-lin" key={e.id} style={{ marginTop: 22, padding: '18px 18px 20px' }}>
            <div className="row" style={{ alignItems: 'baseline', marginBottom: 4 }}>
              <div className="when" style={{ marginBottom: 0 }}>
                Пакет дней{e.validTo ? ` · до ${dayMonth(e.validTo)}` : ''}
              </div>
              <div className="tag tag-ok">{e.kind === 'camp' ? 'лагерь' : 'мастер-класс'}</div>
            </div>
            <div className="what">{e.title}</div>
            <p className="hint" style={{ margin: '8px 0 14px' }}>
              Тратится только здесь: обычные занятия им не оплачиваются, и
              наоборот. Неиспользованные дни сгорают вместе со сменой
              {e.validTo ? `: ${dayMonth(e.validTo)} — последний день` : ''}.
            </p>
            {online ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {e.offers.map((t) => (
                  <form action={buyPassAction} key={t.lessons}>
                    <input type="hidden" name="offer" value={`${e.id}:${t.lessons}`} />
                    <button className="btn-quiet" type="submit"
                            style={{ width: '100%', justifyContent: 'space-between',
                                     background: 'var(--cream)' }}>
                      <span>
                        {t.lessons}&nbsp;{plural(t.lessons, 'день', 'дня', 'дней')}
                        <span className="hint">
                          {' · '}{money(Math.round(t.price / t.lessons), price.currency)} за день
                        </span>
                      </span>
                      <span>{money(t.price, price.currency)}</span>
                    </button>
                  </form>
                ))}
              </div>
            ) : (
              <div className="sub">Пакет можно купить у Вари на занятии.</div>
            )}
          </div>
        ))}

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
            <div className="lbl day-band">История платежей</div>
            {history.map((h) => {
              const what = h.purpose === 'studio_pass'
                  ? (h.group_title ?? 'абонемент')
                : h.purpose === 'studio_test' ? 'проверочный платёж'
                : `занятия${h.lessons ? `, ${h.lessons}` : ''}`;
              const how = h.provider !== 'cash' ? 'картой'
                : h.pay_method ? WAY[h.pay_method]
                : 'наличными или переводом';
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
