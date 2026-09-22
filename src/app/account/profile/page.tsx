import { requireUser } from '@/lib/session';
import { archivedChildren, familyWithDays } from '@/lib/studio';
import AutoSave from '@/components/AutoSave';
import Toggles from '@/components/Toggles';
import YesNo from '@/components/YesNo';
import { chatOfUser } from '@/lib/telegram';
import {
  connectTelegram, createChild, disconnectTelegram, setMyAttendance, togglePreferredDay,
  updateChild, updateMyProfile,
} from '../actions';

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

export default async function ProfilePage(
  { searchParams }: { searchParams: Promise<{ tg?: string }> },
) {
  const user = await requireUser();
  const [family, hidden, chat, params] = await Promise.all([
    familyWithDays(user.id),
    archivedChildren(user.id),
    chatOfUser(user.id),
    searchParams,
  ]);
  // Своя карточка есть всегда, даже если взрослый сам на занятия не ходит
  // и строки участника у него нет: имя-то поменять всё равно нужно.
  const me = family.find((m) => m.is_adult) ?? null;
  const kids = family.filter((m) => !m.is_adult);
  // Взрослый в списке семьи есть всегда, но ходит ли он — отдельный вопрос.
  const attends = me?.attends ?? false;

  return (
    <>
      <div className="top">
        <div className="kicker">Re.Create.Art · Студия</div>
        <h1 className="h1">Профиль</h1>
        <p className="sub">Кто ходит в студию и в какие дни</p>
      </div>

      <div className="body">
        <div className="card">
          <div className="what" style={{ marginBottom: 14 }}>Родитель</div>
          <AutoSave
            action={updateMyProfile}
            hint="Ник не обязателен. Он нужен только затем, чтобы Варя могла быстро написать, если занятие переносится."
          >
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <div className="field" style={{ flex: '1 1 180px', marginBottom: 0, minWidth: 0 }}>
                <label htmlFor="my-name">Имя и фамилия</label>
                <input
                  id="my-name"
                  name="name"
                  defaultValue={user.name ?? ''}
                  placeholder="Как вас зовут"
                  maxLength={120}
                />
              </div>
              <div className="field" style={{ flex: '1 1 180px', marginBottom: 0, minWidth: 0 }}>
                <label htmlFor="my-telegram">Ник в телеграме</label>
                <input
                  id="my-telegram"
                  name="telegram"
                  defaultValue={user.telegram ? `@${user.telegram}` : ''}
                  placeholder="@мой_ник"
                  maxLength={80}
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                />
              </div>
            </div>
          </AutoSave>
          <div className="sub" style={{ marginTop: 10 }}>{user.email}</div>

          <div className="lbl" style={{ margin: '18px 0 0' }}>Хожу на занятия сам</div>
          <YesNo value={attends} action={setMyAttendance} />

          {attends && me && (
            <>
              <div className="lbl" style={{ margin: '18px 0 0' }}>
                Возможные дни моих посещений
              </div>
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

        <div className="card">
          <div className="what" style={{ marginBottom: 6 }}>Телеграм</div>
          {chat ? (
            <>
              <p className="sub">
                Подключён. Бот покажет ближайшую неделю, если ему написать.
              </p>
              <form action={disconnectTelegram} style={{ marginTop: 14 }}>
                <button className="btn-quiet" type="submit">Отключить</button>
              </form>
            </>
          ) : (
            <>
              <p className="sub">
                Бот покажет ближайшую неделю: кто на какое занятие записан и
                сколько осталось мест. Кнопка откроет телеграм — там нужно
                нажать «Запустить».
              </p>
              <form action={connectTelegram} style={{ marginTop: 14 }}>
                <button className="btn" type="submit">Подключить телеграм</button>
              </form>
              {params.tg === 'off' && (
                <p className="hint" style={{ marginTop: 12 }}>
                  Бот ещё не настроен. Попробуйте позже.
                </p>
              )}
            </>
          )}
        </div>

        {kids.map((m) => (
          <div className="card" key={m.participant_id}>
            <AutoSave
              action={updateChild}
              hint="Имя сохраняется само"
              style={{ display: 'flex', gap: 10, alignItems: 'center' }}
            >
              <input type="hidden" name="childId" value={m.child_id ?? ''} />
              <input
                name="name"
                defaultValue={m.who}
                aria-label="Имя и фамилия ребёнка"
                maxLength={120}
                style={nameField}
              />
            </AutoSave>

            <div className="lbl" style={{ margin: '14px 0 0' }}>
              Детские занятия · возможные дни посещений
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
              <label htmlFor="child-name">Имя и фамилия</label>
              <input id="child-name" name="name" required maxLength={120} placeholder="Как зовут" />
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
              Они не записываются на занятия и не появляются в журналах, но
              прошлые занятия и оплаты за них сохранены. Вернуть может Варя.
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
