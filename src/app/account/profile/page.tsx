import { requireUser } from '@/lib/session';
import { archivedChildren, familyWithDays } from '@/lib/studio';
import Toggles from '@/components/Toggles';
import { createChild, togglePreferredDay, updateChild, updateMyName } from '../actions';

export const dynamic = 'force-dynamic';

const nameField: React.CSSProperties = {
  flex: 1, minWidth: 0, border: 0, borderBottom: '1.5px solid transparent',
  background: 'none', outline: 'none', padding: '4px 0',
  fontFamily: "'Cormorant Garamond', serif", fontSize: 21,
};

const WEEK = [
  { n: 1, short: 'пн' }, { n: 2, short: 'вт' }, { n: 3, short: 'ср' }, { n: 4, short: 'чт' },
  { n: 5, short: 'пт' }, { n: 6, short: 'сб' }, { n: 7, short: 'вс' },
];

export default async function ProfilePage() {
  const user = await requireUser();
  const [family, hidden] = await Promise.all([
    familyWithDays(user.id),
    archivedChildren(user.id),
  ]);
  // Своя карточка есть всегда, даже если взрослый сам на занятия не ходит
  // и строки участника у него нет: имя-то поменять всё равно нужно.
  const me = family.find((m) => m.is_adult) ?? null;
  const kids = family.filter((m) => !m.is_adult);

  return (
    <>
      <div className="top">
        <div className="kicker">Re.Create.Art · Студия</div>
        <h1 className="h1">Профиль</h1>
        <p className="sub">Кто ходит в студию и в какие дни</p>
      </div>

      <div className="body">
        <div className="card">
          <form action={updateMyName} style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <input
              name="name"
              defaultValue={user.name ?? ''}
              placeholder="Как вас зовут"
              aria-label="Ваше имя"
              maxLength={120}
              style={nameField}
            />
            <button className="btn-quiet" type="submit">Сохранить</button>
          </form>
          <div className="sub" style={{ marginTop: 4 }}>{user.email}</div>

          {me && (
            <>
              <div className="lbl" style={{ margin: '16px 0 0' }}>Хожу сам</div>
              <Toggles
                items={WEEK.map((d) => ({ id: String(d.n), label: d.short }))}
                active={me.days.map(String)}
                action={togglePreferredDay}
                fields={{ participantId: me.participant_id }}
                itemField="weekday"
              />
              <div className="hint" style={{ marginTop: 10 }}>
                Выбранные дни подсвечиваются в расписании. Записью это не является.
              </div>
            </>
          )}
        </div>

        {kids.map((m) => (
          <div className="card" key={m.participant_id}>
            <form action={updateChild} style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <input type="hidden" name="childId" value={m.child_id ?? ''} />
              <input
                name="name"
                defaultValue={m.who}
                aria-label="Имя ребёнка"
                maxLength={60}
                style={nameField}
              />
              <button className="btn-quiet" type="submit">Переименовать</button>
            </form>

            <div className="sub" style={{ marginTop: 4 }}>Детские занятия</div>

            <Toggles
              items={WEEK.map((d) => ({ id: String(d.n), label: d.short }))}
              active={m.days.map(String)}
              action={togglePreferredDay}
              fields={{ participantId: m.participant_id }}
              itemField="weekday"
            />
            <div className="hint" style={{ marginTop: 10 }}>
              Выбранные дни подсвечиваются в расписании. Записью это не является.
            </div>
          </div>
        ))}

        <div className="card" style={{ borderStyle: 'dashed' }}>
          <div className="what" style={{ marginBottom: 14 }}>Добавить ребёнка</div>
          <form action={createChild} style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
            <div className="field" style={{ flex: 1, marginBottom: 0 }}>
              <label htmlFor="child-name">Имя</label>
              <input id="child-name" name="name" required maxLength={60} placeholder="Как зовут" />
            </div>
            <button className="btn" type="submit">Добавить</button>
          </form>
          <p className="hint" style={{ marginTop: 16 }}>
            Больше ничего вводить не нужно. Мы храним только имя.
          </p>
        </div>

        {hidden.length > 0 && (
          <div className="card">
            <div className="what" style={{ marginBottom: 4 }}>Скрытые</div>
            <p className="hint" style={{ marginBottom: 14 }}>
              Они не появляются в расписании и журналах, но прошлые занятия
              и оплаты за них сохранены. Вернуть может Варя.
            </p>
            {hidden.map((ch) => (
              <div className="sub" key={ch.child_id} style={{ padding: '6px 0' }}>{ch.name}</div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
