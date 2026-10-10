import Link from 'next/link';
import BookingHint from '@/components/BookingHint';
import ContactCard from '@/components/ContactCard';
import EventSignup from '@/components/EventSignup';
import OnlyMine from '@/components/OnlyMine';
import SlotList from '@/components/SlotList';
import { cabinetCourses, longDate } from '@/lib/course';
import { requireParent } from '@/lib/session';
import {
  PASS_WARN_DAYS, eventSlotsForUser, passBalances, slotsForUser, unpaidCharges,
} from '@/lib/studio';
import { chatOfUser } from '@/lib/telegram';
import { dayMonth, daysUntil, money, plural, plusDays, todayISO, weekdayDayMonth } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function WeekPage({
  searchParams,
}: {
  searchParams: Promise<{ all?: string }>;
}) {
  const user = await requireParent();
  // По умолчанию показываем только свои дни: в неделе студии занятий
  // вчетверо больше, чем у одной семьи, и среди чужих теряются свои.
  const showAll = (await searchParams).all === '1';
  const today = todayISO();
  const [passes, unpaid, slots, events, chat, courses] = await Promise.all([
    passBalances(user.id),
    unpaidCharges(user.id),
    slotsForUser(user.id, today, plusDays(today, 7)),
    eventSlotsForUser(user.id),
    chatOfUser(user.id),
    cabinetCourses(user.email),
  ]);

  // Пакет лагеря лежит рядом с обычным абонементом: показываем оба.
  const mine = passes.filter((p) => p.left > 0 && !p.ended);
  // Кончившийся абонемент с экрана не убираем: «куда он делся» — вопрос
  // неприятнее, чем строчка «закончился». Держим его, пока свежий.
  const over = passes.filter((p) => p.ended || p.left === 0);
  const debt = unpaid.reduce((sum, c) => sum + Number(c.amount), 0);

  // Дни лагеря показываем отдельно и целиком, а из недели убираем:
  // два раза одно и то же на одном экране только путает.
  const all = slots.filter((s) => s.kind === 'lesson');
  // «Возможно ходит»: день отмечен в профиле, уже записан или был здесь
  // на днях. Фильтр прячет человека, а не занятие: в семье один ребёнок
  // может ходить по вторникам, другой по четвергам.
  const week = showAll ? all : all.filter((s) => s.preferred || s.booked || s.went);
  const days = [...new Set(week.map((s) => s.held_on))];
  const hidden = all.length - week.length;

  return (
    <>
      <div className="top">
        <div className="kicker">Re.Create.Art · Студия</div>
        <h1 className="h1">Эта неделя</h1>
      </div>

      <div className="body">
        {mine.map((pass) => {
          const ends = pass.valid_to ? daysUntil(pass.valid_to, today) : null;
          const soon = ends !== null && ends <= PASS_WARN_DAYS;
          const what = pass.group_id
            ? plural(pass.left, 'день', 'дня', 'дней')
            : plural(pass.left, 'занятие', 'занятия', 'занятий');
          return (
            <div className="card" key={pass.id}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
                <div className="what">{pass.group_title ?? 'Абонемент'}</div>
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
                {pass.group_id
                  ? 'Только на эти дни. Списывается с того, кто пришёл.'
                  : 'Общий на всех. Списывается с того, кто пришёл.'}
              </div>
              {soon && pass.valid_to && !pass.ended && (
                <div className="money-due" style={{ marginTop: 10 }}>
                  {ends! > 0
                    ? `Действует до ${dayMonth(pass.valid_to)}: ${ends} ${
                        plural(ends!, 'день', 'дня', 'дней')} и ${pass.left} ${what}. Потом сгорит.`
                    : `Сегодня последний день: ${pass.left} ${what} ещё не использовано.`}
                </div>
              )}
            </div>
          );
        })}

        {over.map((pass) => (
          <div className="card" key={pass.id} style={{ opacity: 0.65 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between',
                          alignItems: 'baseline', marginBottom: 8 }}>
              <div className="what">{pass.group_title ?? 'Абонемент'}</div>
              <div style={{ fontSize: 13, color: 'var(--warm-gray)' }}>
                {pass.ended ? 'срок вышел' : 'закончился'}
              </div>
            </div>
            <div className="sub">
              {pass.ended && pass.valid_to
                ? `Действовал до ${dayMonth(pass.valid_to)}.`
                : `Все ${pass.lessons_total} ${
                    pass.group_id
                      ? plural(pass.lessons_total, 'день', 'дня', 'дней')
                      : plural(pass.lessons_total, 'занятие', 'занятия', 'занятий')
                  } использованы.`}
              {pass.ended && pass.left > 0
                ? ` Неиспользованными остались ${pass.left} ${
                    pass.group_id
                      ? plural(pass.left, 'день', 'дня', 'дней')
                      : plural(pass.left, 'занятие', 'занятия', 'занятий')}.`
                : ''}
              {/* Смена кончилась — звать за новым пакетом некуда: его
                  продают к смене, а её больше нет. */}
              {pass.group_id ? '' : (
                <> Новый покупается в <Link href="/account/pay">«Оплате»</Link>.</>
              )}
            </div>
          </div>
        ))}

        {unpaid.length > 0 && (
          <div className="card-lin">
            <div className="row">
              <div>
                <div className="what">
                  Не оплачено {unpaid.length}&nbsp;{plural(unpaid.length, 'занятие', 'занятия', 'занятий')}
                </div>
                <div className="sub">
                  с {dayMonth(unpaid[0].held_on)} ·{' '}
                  <span style={{ color: 'var(--rose-dark)' }}>{money(debt, unpaid[0].currency)}</span>
                </div>
              </div>
              <Link className="btn" href="/account/pay">Оплатить</Link>
            </div>
          </div>
        )}

        <EventSignup rows={events} />

        {/* Заголовок нужен там, где на экране есть ещё и лагерь: без него
            два разных списка с кнопками «Записать» читаются как один. */}
        {all.length === 0 ? (
          <p className="hint" style={{ marginTop: 20 }}>
            На ближайшую неделю обычных занятий нет.
          </p>
        ) : (
          <>
            <div className="what" style={{ margin: '26px 0 12px' }}>Регулярные занятия</div>
            <OnlyMine on={!showAll} />
            {days.length > 0 && <BookingHint />}
          </>
        )}

        {all.length > 0 && days.length === 0 && (
          <p className="hint">
            На этой неделе занятий в ваши дни нет. Снимите отметку, чтобы
            увидеть все {all.length} — записаться можно на любое.
          </p>
        )}

        {days.length > 0 && (
          days.map((day) => (
            <section key={day}>
              <div className="lbl">{weekdayDayMonth(day)}</div>
              <SlotList rows={week.filter((s) => s.held_on === day)} />
            </section>
          ))
        )}

        {/* Сказать, что список неполный, честнее, чем молча его урезать. */}
        {days.length > 0 && hidden > 0 && (
          <p className="hint" style={{ marginTop: 12 }}>
            Ещё {hidden} {plural(hidden, 'занятие', 'занятия', 'занятий')} на неделе
            в другие дни — снимите отметку, чтобы увидеть.
          </p>
        )}

        {/* Видеокурс, купленный на ту же почту. Курс живёт отдельно от
            студии, это единственное место, где они встречаются: отсюда
            курс открывается без ссылки из письма. */}
        {courses.map((c) => (
          <div className="card" key={c.slug} style={{ marginTop: 20, ...(c.expired ? { opacity: 0.65 } : {}) }}>
            <div className="row">
              <div>
                <div className="what">{c.title}</div>
                <div className="sub">
                  Видеокурс · {c.expired ? `доступ закончился ${longDate(c.until)}` : `доступ до ${longDate(c.until)}`}
                </div>
              </div>
              {!c.expired && <a className="btn" href={`/learn/${c.slug}`}>Открыть</a>}
            </div>
          </div>
        ))}

        {/* Внизу «Недели»: сюда доходят, когда что-то понадобилось, а
            куда писать — до сих пор в кабинете не было сказано нигде. */}
        <ContactCard chat={Boolean(chat)} />
      </div>
    </>
  );
}
