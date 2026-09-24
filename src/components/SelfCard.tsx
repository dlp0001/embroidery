import AutoSave from '@/components/AutoSave';
import Toggles from '@/components/Toggles';
import YesNo from '@/components/YesNo';
import {
  connectTelegram, disconnectTelegram, setMyAttendance, togglePreferredDay, updateMyProfile,
} from '@/app/account/actions';

const WEEK = [
  { n: 1, short: 'пн' }, { n: 2, short: 'вт' }, { n: 3, short: 'ср' }, { n: 4, short: 'чт' },
  { n: 5, short: 'пт' }, { n: 6, short: 'сб' }, { n: 7, short: 'вс' },
];

/**
 * Своё имя, ник и телеграм. Родитель правит это в кабинете, а у того,
 * кто ведёт занятия, кабинета нет — и та же карточка живёт в «Админе».
 * Одна на двоих: поля и так одни и те же, а разъедутся они быстро.
 */
export default function SelfCard({
  user,
  chat,
  botOff = false,
  title = 'Родитель',
  attends = null,
}: {
  user: { name: string | null; email: string; telegram: string | null };
  /** Телеграм подключён: бот знает, кому писать. */
  chat: boolean;
  botOff?: boolean;
  title?: string;
  /** Дни собственных посещений. Тому, кто занятия ведёт, они ни к чему. */
  attends?: { value: boolean; participantId: string | null; days: number[] } | null;
}) {
  return (
    <>
      <div className="card">
        <div className="what" style={{ marginBottom: 14 }}>{title}</div>
        <AutoSave
          action={updateMyProfile}
          hint="Ник не обязателен и нужен только для личных сообщений: бот пишет через «Подключить телеграм», а по нику Варя может написать вам сама."
        >
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div className="field" style={{ flex: '1 1 180px', marginBottom: 0, minWidth: 0 }}>
              <label htmlFor="my-name">Имя и фамилия</label>
              {/* Форма сохраняется сама и не отправляется, поэтому
                  браузерная проверка required не сработала бы: пустое имя
                  отклоняет действие, а AutoSave показывает это после
                  ухода из поля. */}
              <input
                id="my-name"
                name="name"
                defaultValue={user.name ?? ''}
                placeholder="Как вас зовут"
                maxLength={120}
                aria-required="true"
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
        {/* Новичок попадает сюда сразу после входа, и поле у него пустое.
            Молча ждать, пока он сам догадается, незачем. */}
        {!user.name?.trim() && (
          <p className="err" style={{ margin: '10px 0 0' }}>
            Заполните имя и фамилию: по ним Варя понимает, кто записывает ребёнка.
          </p>
        )}
        <div className="sub" style={{ marginTop: 10 }}>{user.email}</div>

        {attends && (
          <>
            <div className="lbl" style={{ margin: '18px 0 0' }}>Хожу на занятия сам</div>
            <YesNo value={attends.value} action={setMyAttendance} />

            {attends.value && attends.participantId && (
              <>
                <div className="lbl" style={{ margin: '18px 0 0' }}>
                  Возможные дни моих посещений
                </div>
                <Toggles
                  items={WEEK.map((d) => ({ id: String(d.n), label: d.short }))}
                  active={attends.days.map(String)}
                  action={togglePreferredDay}
                  fields={{ participantId: attends.participantId }}
                  itemField="weekday"
                />
                <div className="hint" style={{ marginTop: 10 }}>
                  Выбранные дни подсвечиваются в расписании. Записью это не является.
                </div>
              </>
            )}
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
            {botOff && (
              <p className="hint" style={{ marginTop: 12 }}>
                Бот ещё не настроен. Попробуйте позже.
              </p>
            )}
          </>
        )}
      </div>
    </>
  );
}
