import { isAdmin, requireTeacher } from '@/lib/session';
import { families } from '@/lib/studio';
import { plural } from '@/lib/format';
import Toggles from '@/components/Toggles';
import {
  addChildAction, createParentAction, renameChildAction, renameUserAction,
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
  const list = await families();

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
            <form action={renameUserAction} style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <input type="hidden" name="userId" value={f.user_id} />
              <input name="name" defaultValue={f.name ?? ''} aria-label="Имя"
                     placeholder="без имени"
                     style={{ ...inline, fontFamily: "'Cormorant Garamond', serif", fontSize: 23 }} />
              <button className="btn-quiet" type="submit">Переименовать</button>
            </form>
            <div className="sub">{f.email}{f.roles.length ? ` · ${f.roles.join(', ')}` : ''}</div>

            <div className="lbl" style={{ margin: '16px 0 0' }}>Ходит сам</div>
            <DayRow participantId={f.participant_id} days={f.own_days ?? []} />

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
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <form action={renameChildAction} style={{ display: 'flex', gap: 8, alignItems: 'center', flex: 1 }}>
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
                <input id={`child-${f.user_id}`} name="name" maxLength={60} placeholder="Имя" />
              </div>
              <button className="btn-quiet" type="submit">Добавить</button>
            </form>
          </div>
        ))}

        {list.length === 0 && <p className="hint" style={{ marginTop: 20 }}>Пока никого нет.</p>}

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
