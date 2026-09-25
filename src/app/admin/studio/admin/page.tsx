import { redirect } from 'next/navigation';
import { currentUser, isAdmin, isSuperadmin, isTeacher } from '@/lib/session';
import { cabinetOwners, lessonPrice, mergeCandidates, type MergeCandidate } from '@/lib/studio';
import SelfCard from '@/components/SelfCard';
import { chatOfUser } from '@/lib/telegram';
import { isConfigured as payConfigured } from '@/lib/payplus';
import { lastTestPayment, TEST_AMOUNT } from '@/lib/billing';
import { testPaymentAction } from '@/app/account/pay/actions';
import { money } from '@/lib/format';
import { mergeChildAction } from '@/app/admin/people-actions';
import { viewAsAction } from '@/app/admin/view-actions';

export const dynamic = 'force-dynamic';

/** Тёзок в студии хватает, поэтому в списке имя идёт с родителем. */
function label(c: MergeCandidate): string {
  const parts = [c.name];
  if (c.parent) parts.push(c.parent);
  if (c.archived) parts.push('скрыт');
  return parts.join(' · ');
}

export default async function AdminToolsPage({
  searchParams,
}: {
  searchParams: Promise<{ note?: string; error?: string }>;
}) {
  const user = await currentUser();
  // Закладка админская: преподавателю тут делать нечего.
  if (!user || !isAdmin(user)) redirect('/admin/studio');

  const { note, error } = await searchParams;
  const looker = isSuperadmin(user);
  // Кабинета у Вари нет, поэтому своё имя, ник и телеграм она правит
  // здесь же — и проверочный платёж отсюда же, это тоже не родительское
  // дело.
  const online = payConfigured();
  const teaches = isTeacher(user);
  const [kids, all, chat, lastTest, price] = await Promise.all([
    mergeCandidates(),
    looker ? cabinetOwners() : [],
    chatOfUser(user.id),
    online ? lastTestPayment(user.id) : Promise.resolve(null),
    lessonPrice(),
  ]);
  const mode = process.env.PAYPLUS_ENV === 'prod' ? 'боевая' : 'тестовая';
  // Себя в списке не показываем: свой кабинет открывается без подмены.
  const owners = all.filter((o) => o.id !== user.id);

  return (
    <>
      <div className="top">
        <div className="kicker">Re.Create.Art · Админ</div>
        <h1 className="h1">Админ</h1>
        <p className="sub">То, что нужно изредка и всей студии сразу</p>
      </div>

      <div className="body">
        {note && <p className="note" style={{ marginBottom: 14 }}>{note}</p>}
        {error && <p className="err" style={{ marginBottom: 14 }}>{error}</p>}

        {/* У кого кабинет остался, тот правит своё имя там: две одинаковые
            карточки на одного человека только путают. */}
        {/* Дни своих посещений сюда не выносим: тот, кто занятия ведёт,
            на них не записывается. Видно этот флаг в «Людях». */}
        {teaches && <SelfCard user={user} chat={Boolean(chat)} title="Обо мне" />}

        <div className="card">
          <div className="what" style={{ marginBottom: 6 }}>Объединить детей</div>
          <p className="hint" style={{ marginBottom: 16 }}>
            Одного ребёнка заводят дважды: Варя на занятии, родитель в кабинете.
            Записи можно склеить, и не обязательно внутри одной семьи. Занятия,
            посещения, деньги и дни недели переедут в ту запись, которая
            остаётся. Первая запись исчезнет, отменить это нельзя.
          </p>
          <p className="hint" style={{ marginBottom: 16 }}>
            Родители складываются: если записи были в разных семьях, у ребёнка
            окажется двое родителей — например, мама и мама подружки, с которой
            он когда-то пришёл. Лишнего уберите в «Людях»: под именем ребёнка
            будет строка «ещё родитель» и ссылка «отвязать отсюда». Сделать это
            стоит сразу: пока родителей двое, неясно, кому считать следующее
            занятие.
          </p>

          {kids.length < 2 ? (
            <p className="hint">Склеивать пока нечего: в студии меньше двух детей.</p>
          ) : (
            <form action={mergeChildAction}
                  style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div className="field" style={{ marginBottom: 0 }}>
                <label htmlFor="merge-from">Эта запись исчезнет</label>
                <select id="merge-from" name="childId" defaultValue="" required>
                  <option value="" disabled>— выберите ребёнка —</option>
                  {kids.map((c) => (
                    <option key={c.child_id} value={c.child_id}>{label(c)}</option>
                  ))}
                </select>
              </div>

              <div className="field" style={{ marginBottom: 0 }}>
                <label htmlFor="merge-into">И станет этой</label>
                <select id="merge-into" name="intoChildId" defaultValue="" required>
                  <option value="" disabled>— выберите ребёнка —</option>
                  {kids.map((c) => (
                    <option key={c.child_id} value={c.child_id}>{label(c)}</option>
                  ))}
                </select>
              </div>

              <button className="btn-wide" type="submit">Объединить</button>
            </form>
          )}
        </div>

        {looker && (
          <div className="card" style={{ marginTop: 16 }}>
            <div className="what" style={{ marginBottom: 6 }}>Посмотреть чужой кабинет</div>
            <p className="hint" style={{ marginBottom: 16 }}>
              Открывает кабинет чужими глазами: те же занятия, долги и кнопки,
              что видит человек. Только смотреть — записать, оплатить или
              переименовать оттуда нельзя. Наверху будет полоса с возвратом
              к себе, и там же можно перейти к следующему человеку, не
              возвращаясь сюда.
            </p>

            {owners.length === 0 ? (
              <p className="hint">Кабинетов пока ни у кого нет.</p>
            ) : (
              <form action={viewAsAction}
                    style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div className="field" style={{ marginBottom: 0 }}>
                  <label htmlFor="view-as">Чей кабинет</label>
                  <select id="view-as" name="userId" defaultValue="" required>
                    <option value="" disabled>— выберите человека —</option>
                    {owners.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name ?? o.email}{o.teaches ? ' · студия' : ''}
                      </option>
                    ))}
                  </select>
                </div>

                <button className="btn-wide" type="submit">Посмотреть</button>
              </form>
            )}
          </div>
        )}

        {online && (
          <div className="card" style={{ borderStyle: 'dashed', marginTop: 16 }}>
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
