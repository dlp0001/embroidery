import { isAdmin, requireTeacher } from '@/lib/session';
import { families, orphanChildren } from '@/lib/studio';
import { dayMonth, plural } from '@/lib/format';
import Toggles from '@/components/Toggles';
import {
  addChildAction, createParentAction, linkChildAction, renameChildAction, renameUserAction,
  restoreChildAction, retireChildAction, toggleDayAction,
} from '@/app/admin/people-actions';

export const dynamic = 'force-dynamic';

const WD = ['', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];
const WEEK = [1, 2, 3, 4, 5, 6, 7];

/** Дни, в которые человек обычно ходит: подсвечивают его в журнале. */
function DayRow({ participantId, days }: { participantId: string | null; days: number[] }) {
  if (!participantId) return null;
  return (
    <>
      <Toggles
        items={WEEK.map((n) => ({ id: String(n), label: WD[n] }))}
        active={days.map(String)}
        action={toggleDayAction}
        fields={{ participantId }}
        itemField="weekday"
      />
    </>
  );
}

const inline: React.CSSProperties = {
  flex: 1, minWidth: 0, border: 0, borderBottom: '1.5px solid transparent',
  background: 'none', outline: 'none', padding: '4px 0',
};

export default async function PeoplePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; note?: string; add?: string }>;
}) {
  const user = await requireTeacher();
  if (!isAdmin(user)) {
    return (
      <>
        <div className="top">
          <div className="kicker">Re.Create.Art · Студия</div>
          <h1 className="h1">Люди</h1>
        </div>
        <div className="body">
          <p className="hint">Этот раздел доступен админу.</p>
        </div>
      </>
    );
  }

  const { error, note, add } = await searchParams;
  const [list, orphans] = await Promise.all([families(), orphanChildren()]);

  return (
    <>
      <div className="top">
        <div className="kicker">Re.Create.Art · Студия</div>
        <div className="row">
          <h1 className="h1">Люди</h1>
          {!add && <a className="btn" href="/admin/studio/people?add=1">Новый</a>}
        </div>
      </div>

      <div className="body">
        {error && <p className="err">{error}</p>}
        {note && <p className="note">{note}</p>}

        {orphans.length > 0 && (
          <div className="card" style={{ borderColor: 'var(--rose-light)' }}>
            <div className="what" style={{ marginBottom: 6 }}>Дети без родителя</div>
            <p className="hint" style={{ marginBottom: 16 }}>
              Их привели на занятие и отметили, но платить за них пока некому.
              Занятия не посчитаны, пока ребёнок не привязан к взрослому.
            </p>

            {orphans.map((ch) => (
              <form
                action={linkChildAction}
                key={ch.child_id}
                style={{ padding: '14px 0', borderTop: '1px solid var(--line-soft)' }}
              >
                <input type="hidden" name="childId" value={ch.child_id} />
                <div className="what" style={{ fontSize: 20 }}>{ch.name}</div>
                <div className="sub" style={{ marginBottom: 12 }}>
                  {ch.visits > 0
                    ? `${ch.visits} ${plural(ch.visits, 'посещение', 'посещения', 'посещений')}${
                        ch.last_seen ? `, последнее ${dayMonth(ch.last_seen)}` : ''}`
                    : 'посещений пока нет'}
                </div>

                <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                  <div className="field" style={{ flex: '1 1 200px', marginBottom: 0, minWidth: 0 }}>
                    <label htmlFor={`to-${ch.child_id}`}>Чей это ребёнок</label>
                    <select id={`to-${ch.child_id}`} name="userId" required>
                      <option value="">выберите родителя</option>
                      {list.map((f) => (
                        <option key={f.user_id} value={f.user_id}>{f.name ?? f.email}</option>
                      ))}
                    </select>
                  </div>
                  <button className="btn-quiet" type="submit">Привязать</button>
                </div>

                {ch.visits > 0 && (
                  <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginTop: 14, cursor: 'pointer' }}>
                    <input type="checkbox" name="chargePast" defaultChecked
                           style={{ width: 20, height: 20, marginTop: 2 }} />
                    <span className="hint">
                      Начислить за прошлые посещения по сегодняшней цене
                    </span>
                  </label>
                )}
              </form>
            ))}
          </div>
        )}

        {add && (
          <div className="card" style={{ borderStyle: 'dashed' }}>
            <div className="what" style={{ marginBottom: 16 }}>Новый родитель</div>
            <form action={createParentAction} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div className="field" style={{ marginBottom: 0 }}>
                <label htmlFor="p-name">Имя</label>
                <input id="p-name" name="name" maxLength={120} placeholder="Таня Либерман" />
              </div>
              <div className="field" style={{ marginBottom: 0 }}>
                <label htmlFor="p-email">Почта</label>
                <input id="p-email" name="email" type="email" required placeholder="tanya@example.com" />
              </div>
              <button className="btn-wide" type="submit">Завести</button>
            </form>
            <p className="hint" style={{ marginTop: 14 }}>
              По этому адресу человек будет входить в кабинет. Пароль не нужен, код приходит письмом.
            </p>
            <a className="hint" href="/admin/studio/people" style={{ display: 'block', marginTop: 10 }}>Отмена</a>
          </div>
        )}

        {list.map((f) => (
          <div className="card" key={f.user_id}>
            <form action={renameUserAction}>
              <input type="hidden" name="userId" value={f.user_id} />
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <input name="name" defaultValue={f.name ?? ''} aria-label="Имя"
                       placeholder="без имени"
                       style={{ ...inline, fontFamily: "'Cormorant Garamond', serif", fontSize: 23 }} />
                <button className="btn-quiet" type="submit">Сохранить</button>
              </div>
              <div className="sub">{f.email}{f.roles.length ? ` · ${f.roles.join(', ')}` : ''}</div>
              <div className="sub" style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                <label htmlFor={`bill-${f.user_id}`}>Имя для квитанции:</label>
                <input id={`bill-${f.user_id}`} name="billingName" maxLength={120}
                       defaultValue={f.billing_name ?? ''} placeholder="Tanya Liberman"
                       style={{ ...inline, font: 'inherit', color: 'inherit' }} />
              </div>
            </form>

            {f.attends ? (
              <>
                <div className="lbl" style={{ margin: '16px 0 0' }}>Ходит сам</div>
                <DayRow participantId={f.participant_id} days={f.own_days ?? []} />
              </>
            ) : (
              <div className="lbl" style={{ margin: '16px 0 0' }}>Сам не ходит</div>
            )}

            <div className="lbl" style={{ margin: '18px 0 0' }}>
              Дети: {f.children.length}&nbsp;{plural(f.children.length, 'ребёнок', 'ребёнка', 'детей')}
            </div>

            {f.children.map((ch) => (
              <div key={ch.child_id} style={{ padding: '12px 0', borderBottom: '1px solid var(--line-soft)' }}>
                {ch.archived ? (
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="what" style={{ opacity: 0.5 }}>{ch.name}</div>
                      <div className="sub">скрыт, в журналах не появляется</div>
                    </div>
                    <form action={restoreChildAction}>
                      <input type="hidden" name="childId" value={ch.child_id} />
                      <button className="btn-quiet" type="submit">Вернуть</button>
                    </form>
                  </div>
                ) : (
                  <>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                      <form action={renameChildAction} style={{ display: 'flex', gap: 8, alignItems: 'center', flex: '1 1 260px', minWidth: 0 }}>
                        <input type="hidden" name="childId" value={ch.child_id} />
                        <input name="name" defaultValue={ch.name} aria-label="Имя ребёнка"
                               style={{ ...inline, fontFamily: "'Cormorant Garamond', serif", fontSize: 20 }} />
                        <button className="btn-quiet" type="submit">Переименовать</button>
                      </form>
                      <form action={retireChildAction}>
                        <input type="hidden" name="childId" value={ch.child_id} />
                        <button className="btn-quiet" type="submit" aria-label={`Убрать ${ch.name}`}>Убрать</button>
                      </form>
                    </div>
                    <DayRow participantId={ch.participant_id} days={ch.days ?? []} />
                  </>
                )}
              </div>
            ))}

            <form action={addChildAction} style={{ display: 'flex', gap: 10, alignItems: 'flex-end', marginTop: 16 }}>
              <input type="hidden" name="userId" value={f.user_id} />
              <div className="field" style={{ flex: 1, marginBottom: 0 }}>
                <label htmlFor={`child-${f.user_id}`}>Добавить ребёнка</label>
                <input id={`child-${f.user_id}`} name="name" maxLength={120} placeholder="Имя" />
              </div>
              <button className="btn-quiet" type="submit">Добавить</button>
            </form>
          </div>
        ))}

        {list.length === 0 && <p className="hint" style={{ marginTop: 20 }}>Пока никого нет.</p>}

        <p className="hint" style={{ marginTop: 18 }}>
          Имя для квитанции печатается в чеке и уходит в бухгалтерию. Пишется
          латиницей и одинаково у всех, потому что по нему сходятся документы.
          Пусто — в квитанцию пойдёт обычное имя.
        </p>

        <p className="hint" style={{ marginTop: 18 }}>
          Дни сохраняются сразу, отдельная кнопка им не нужна.
          Дни — это те, в которые человек обычно приходит. По ним он попадает в журнал
          нужного занятия и в раздел «ждём». На конкретное занятие родитель записывается
          сам, в своём кабинете. «Убрать» стирает ребёнка, если он ещё не был
          ни на одном занятии, и прячет, если посещения уже есть: журналы и
          деньги прошлых занятий переписывать нельзя.
        </p>
      </div>
    </>
  );
}
