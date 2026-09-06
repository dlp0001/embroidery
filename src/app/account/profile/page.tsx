import { requireUser } from '@/lib/session';
import { familyWithDays } from '@/lib/studio';
import Toggles from '@/components/Toggles';
import { createChild, togglePreferredDay, updateChild } from '../actions';

export const dynamic = 'force-dynamic';

const WEEK = [
  { n: 1, short: 'пн' }, { n: 2, short: 'вт' }, { n: 3, short: 'ср' }, { n: 4, short: 'чт' },
  { n: 5, short: 'пт' }, { n: 6, short: 'сб' }, { n: 7, short: 'вс' },
];

export default async function ProfilePage() {
  const user = await requireUser();
  const family = await familyWithDays(user.id);

  return (
    <>
      <div className="top">
        <div className="kicker">Re.Create.Art · Студия</div>
        <h1 className="h1">Профиль</h1>
        <p className="sub">Кто ходит в студию и в какие дни</p>
      </div>

      <div className="body">
        {family.map((m) => (
          <div className="card" key={m.participant_id}>
            {m.is_adult ? (
              <div className="what">{user.name ?? 'Я'}</div>
            ) : (
              <form action={updateChild} style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <input type="hidden" name="childId" value={m.child_id ?? ''} />
                <input
                  name="name"
                  defaultValue={m.who}
                  aria-label="Имя ребёнка"
                  style={{
                    flex: 1, minWidth: 0, border: 0, borderBottom: '1.5px solid transparent',
                    background: 'none', outline: 'none', padding: '4px 0',
                    fontFamily: "'Cormorant Garamond', serif", fontSize: 21,
                  }}
                />
                <button className="btn-quiet" type="submit">Переименовать</button>
              </form>
            )}

            <div className="sub" style={{ marginTop: 4 }}>
              {m.is_adult ? 'Взрослые занятия' : 'Детские занятия'}
            </div>

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
      </div>
    </>
  );
}
