import type { Metadata } from 'next';
import { currentUser } from '@/lib/session';
import {
  eventDays, eventSlotsForUser, publicEvents,
  type EventDay, type PublicEvent, type SlotRow,
} from '@/lib/studio';
import { toggleBooking } from '@/app/account/actions';
import { dayMonth, hhmm, money, plural, todayISO } from '@/lib/format';
import { CAMP_CSS } from './styles';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Творческий лагерь · Re.Create.Art',
  description:
    'Творческий лагерь и мастер-классы Вари Перлиной в студии на Старом Севере Тель-Авива: даты, цены и запись.',
};

const WD_SHORT = ['', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

/** «Пн · Вт · Чт» — как в расписании студии. Пусто — значит все дни подряд. */
function days(e: PublicEvent): string {
  if (e.weekdays.length === 0 || e.weekdays.length === 7) return 'Каждый день';
  return [...e.weekdays].sort((a, b) => a - b).map((d) => WD_SHORT[d]).join(' · ');
}

/** Конец дня считаем от начала и длительности. */
function endsAt(e: PublicEvent): string {
  const [h, m] = e.starts_at.split(':').map(Number);
  const end = h * 60 + m + e.duration_min;
  return `${String(Math.floor(end / 60) % 24).padStart(2, '0')}:${String(end % 60).padStart(2, '0')}`;
}

/** «10:00 — 14:00» для строки расписания. */
function hours(e: PublicEvent): string {
  return `${hhmm(e.starts_at)} — ${endsAt(e)}`;
}

function period(e: PublicEvent): string {
  return `${dayMonth(e.starts_on)} — ${dayMonth(e.ends_on)}`;
}

/** Мастер-класс на один день описывается иначе, чем лагерь на неделю. */
function oneDay(e: PublicEvent): boolean {
  return e.starts_on === e.ends_on;
}

/**
 * Что будет в этот день. Пока пусто: Варя допишет темы ближе к смене,
 * и тогда они переедут отсюда в базу, к самому дню.
 */
const PROGRAMME: Record<string, string> = {};

export default async function CampPage() {
  const events = await publicEvents();
  const camp = events.find((e) => e.kind === 'camp') ?? events[0] ?? null;

  // Записывать можно прямо отсюда: если человек уже вошёл, показываем
  // его детей, если нет — дорогу в кабинет.
  const me = await currentUser();
  const [days, slots] = await Promise.all([
    camp ? eventDays(camp.id) : Promise.resolve([] as EventDay[]),
    me ? eventSlotsForUser(me.id) : Promise.resolve([] as SlotRow[]),
  ]);
  const mine = camp ? slots.filter((s) => s.group_id === camp.id) : [];

  return (
    <div className="lp">
      <style dangerouslySetInnerHTML={{ __html: CAMP_CSS }} />

      <nav>
        <a href="/" className="nav-logo">Re.Create.Art · <span>Варя Перлина</span></a>
        <div className="nav-side">
          <a href="/" className="nav-back" aria-label="На главную">←<span className="nav-word"> На главную</span></a>
          <a href="/login" className="nav-cta">Кабинет</a>
        </div>
      </nav>

      <section className="hero">
        <div className="hero-left">
          <div className="hero-pretitle">
            {camp ? 'Лагерь · Старый Север, Тель-Авив' : 'Лагерь'}
          </div>
          <h1 className="hero-title">Творческий</h1>
          <div className="hero-title-italic">лагерь</div>
          <p className="hero-desc">
            {camp
              ? `${period(camp)}, каждый день с ${hhmm(camp.starts_at)} до ${endsAt(camp)}. Пять часов, чтобы творить и делать невероятные штуки. А ещё это лагерь лайфхаков: будем чинить, шить, печь и готовить, разбирать и собирать. И не всё время в студии: в смене бывают поездки и походы в музей.`
              : 'Варя ведёт творческие занятия в студии и в детских лагерях. Даты ближайшей смены появятся здесь.'}
          </p>
          <a href={camp ? '/login' : 'mailto:info@re-create.art'} className="hero-cta">
            {camp ? 'Записаться в кабинете' : 'Написать Варе'}
          </a>
        </div>
        <div className="hero-right">
          <img src="/camp.jpg" alt="Дети рисуют, устроившись на полу в зале музея" />
        </div>
      </section>

      {events.length === 0 ? (
        <section className="wrap">
          <div className="eyebrow">Скоро</div>
          <h2 className="h2">Смена ещё не объявлена</h2>
          <p className="lead">
            Даты, цены и запись появятся на этой странице. Пока про лагерь можно
            спросить письмом: <a className="mail" href="mailto:info@re-create.art">info@re-create.art</a>.
            А обычные занятия идут круглый год — расписание на странице{' '}
            <a className="mail" href="/studio">студии</a>.
          </p>
        </section>
      ) : (
        events.map((e, i) => (
          <Event key={e.id} e={e} tinted={i % 2 === 1} />
        ))
      )}

      {events.length > 0 && (
        <section className="wrap wrap-tint">
          <div className="inner">
            <div className="eyebrow">Как это выглядит</div>
            <h2 className="h2">Обычный день<br /><em>в смене</em></h2>
            <p className="lead">
              Шьют, рисуют по ткани, строят из картона то, что не помещается
              в руках. Фотографии со смен, без постановки.
            </p>
            <div className="shots">
              <img src="/camp-1.jpg" alt="Дети рисуют за общим столом в студии" />
              <img src="/camp-2.jpg" alt="Девочка расписывает ткань маркером" />
              <img src="/camp-3.jpg" alt="Девочка шьёт игрушку из фетра" />
              <img src="/camp-4.jpg" alt="Девочка держит картонную конструкцию в свой рост" />
            </div>
          </div>
        </section>
      )}

      {events.length > 0 && (
        <section className="wrap">
          <div className="eyebrow">Цены</div>
          <h2 className="h2">День или пакет,<br /><em>как удобнее</em></h2>
          <p className="lead" style={{ marginBottom: 34 }}>
            Платить можно за каждый день отдельно или взять пакет дней. Пакет
            покупается в кабинете или у Вари и работает на всю семью: сколько
            дней в нём осталось, видно там же.
          </p>
          {events.map((e) => <Prices key={e.id} e={e} />)}
        </section>
      )}

      {camp && days.length > 0 && (
        <section className="wrap">
          <div className="eyebrow">Программа</div>
          <h2 className="h2">Что будет<br /><em>по дням</em></h2>
          <p className="lead">
            В каждом дне и творчество, и что-нибудь полезное руками, а ещё
            в смене бывают поездки и походы в музей. Темы Варя допишет ближе
            к смене. Записаться можно уже сейчас: отметьте дни, в которые
            ребёнок придёт, отметку можно снять в любой момент.
          </p>

          <div className="prog">
            {days.map((d) => (
              <Day key={d.session_id} day={d} slots={mine.filter((s) => s.held_on === d.held_on)}
                   signedIn={me !== null} />
            ))}
          </div>

          <p className="after">
            {me
              ? 'Отмеченные дни видно и в кабинете, на закладке «Неделя».'
              : 'Чтобы записаться, войдите в кабинет: пароль не нужен, придёт код на почту.'}
          </p>
        </section>
      )}

      {events.length > 0 && (
        <section className="wrap wrap-tint">
          <div className="inner">
          <div className="eyebrow">Как это устроено</div>
          <h2 className="h2">Правила простые<br />и их немного</h2>

          <div className="rules">
            <div className="rule">
              <div className="rule-t">Записываться нужно заранее</div>
              <p className="rule-d">
                В кабинете отмечаются дни, в которые ребёнок придёт. Варя видит их
                в журнале и готовит материалы. Отметку можно снять в любой момент.
              </p>
            </div>
            <div className="rule">
              <div className="rule-t">Пакет дней живёт только здесь</div>
              <p className="rule-d">
                Дни из пакета тратятся на лагерь и ни на что больше. Обычный
                абонемент студии в лагере не работает, и наоборот. Зато пакет
                общий на всю семью: дни идут на любого из детей, отдельный
                пакет на каждого не нужен. Неиспользованные дни сгорают
                вместе со сменой.
              </p>
            </div>
            <div className="rule">
              <div className="rule-t">Платим за то, что было</div>
              <p className="rule-d">
                День считается только тогда, когда ребёнок пришёл. Без пакета
                каждый день платится отдельно — в кабинете видно, что оплачено,
                а что нет.
              </p>
            </div>
            <div className="rule">
              <div className="rule-t">Обычные занятия идут как шли</div>
              <p className="rule-d">
                Смена ничего не отменяет: расписание студии на эти дни
                остаётся прежним. Можно прийти и на лагерь днём, и на своё
                занятие потом.
              </p>
            </div>
            <div className="rule">
              <div className="rule-t">Не всё время в студии</div>
              <p className="rule-d">
                В смене бывают поездки и походы в музей: рисуем прямо в залах,
                на полу, и возвращаемся с тем, что там увиделось. Про такой
                день предупреждаем заранее.
              </p>
            </div>
            <div className="rule">
              <div className="rule-t">Что приносить</div>
              <p className="rule-d">
                Ничего: материалы и инструменты студийные. Кроме того, что
                захочется — скетчбук, вещь, которую давно хочется раскрасить,
                печенье, картонную коробку от холодильника.
              </p>
            </div>
            <div className="rule">
              <div className="rule-t">Еда входит в цену</div>
              <p className="rule-d">
                Кормим весь день: паста, овощи, фрукты, снэки и всё подряд.
                Платить отдельно и собирать с собой контейнеры не нужно.
                А в какие-то дни будем готовить сами — это тоже занятие.
              </p>
            </div>
            <div className="rule">
              <div className="rule-t">Оплата</div>
              <p className="rule-d">
                Картой, Apple Pay или Google Pay, битом, пейбоксом или наличными.
                Пакет покупается в кабинете или у Вари.
              </p>
            </div>
          </div>
          </div>
        </section>
      )}

      <section className="wrap">
        <div>
          <div className="eyebrow">Кабинет</div>
          <h2 className="h2">Запись, дни и оплата —<br /><em>в личном кабинете</em></h2>
          <p className="lead">
            Пароль не нужен: вводите почту, получаете код из письма и заходите.
            Внутри видно дни смены, на какие из них записан ребёнок, сколько дней
            осталось в пакете и что уже оплачено.
          </p>
          <a href="/login" className="cta">Войти в кабинет</a>
        </div>
      </section>

      <footer>
        <div className="footer-logo">Re.Create.Art · Варя Перлина</div>
        <div className="footer-links">
          <a href="/studio">Студия</a>
          <a href="/embroidery">Курс вышивки</a>
          <a href="/portfolio">Портфолио</a>
          <a href="/agreement">Соглашение</a>
          <a href="/privacy-ru">Конфиденциальность</a>
        </div>
      </footer>
    </div>
  );
}

const DOW = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];

function dowName(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  return DOW[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

/**
 * День смены: что в нём будет и кнопки записи. Вошедшему показываем его
 * детей, остальным — дорогу в кабинет: записывать можно только своих.
 */
function Day({
  day,
  slots,
  signedIn,
}: {
  day: EventDay;
  slots: SlotRow[];
  signedIn: boolean;
}) {
  const free = day.capacity === null ? null : Math.max(day.capacity - day.taken, 0);
  const text = PROGRAMME[day.held_on];
  // Прошедший день смены записи не принимает: он уже был.
  const past = day.held_on < todayISO();

  return (
    <div className="prog-row">
      <div>
        <span className="prog-dow">{dowName(day.held_on)}</span>
        <span className="prog-day">{dayMonth(day.held_on)}</span>
      </div>

      <div className="prog-what">
        {text ?? <span className="prog-soon">Тему этого дня допишем</span>}
      </div>

      <div className="prog-act">
        {free !== null && (
          <span className="prog-seats">{free > 0 ? `мест: ${free}` : 'мест нет'}</span>
        )}

        {!signedIn && <a className="prog-cta" href="/login">Кабинет</a>}

        {signedIn && slots.length === 0 && (
          <a className="prog-cta" href="/account/profile">Кабинет</a>
        )}

        {slots.map((s) => {
          const full = (free === 0 && !s.booked) || (past && !s.booked);
          return (
            <form action={toggleBooking} key={s.participant_id}>
              <input type="hidden" name="sessionId" value={s.session_id} />
              <input type="hidden" name="participantId" value={s.participant_id} />
              <input type="hidden" name="booked" value={s.booked ? '0' : '1'} />
              <button type="submit" className={s.booked ? 'kid kid-on' : 'kid'}
                      disabled={full} aria-pressed={s.booked}
                      aria-label={`${s.who}, ${dayMonth(day.held_on)}: ${
                        past && !s.booked ? 'день прошёл'
                          : full ? 'мест нет'
                          : s.booked ? 'отменить запись' : 'записать'}`}>
                {s.who}
              </button>
            </form>
          );
        })}
      </div>
    </div>
  );
}

/** Одна смена: когда она идёт. Цены отдельно, ближе к концу страницы. */
function Event({ e, tinted }: { e: PublicEvent; tinted: boolean }) {
  const kind = e.kind === 'camp' ? 'Лагерь' : 'Мастер-класс';
  const who = e.audience === 'adults' ? 'Для взрослых' : 'Для детей';

  return (
    <section className={tinted ? 'wrap wrap-tint' : 'wrap'}>
      <div className={tinted ? 'inner' : undefined}>
        <div className="eyebrow">{kind}</div>
        <h2 className="h2">
          {e.title},<br /><em>{period(e)}</em>
        </h2>
        <p className="lead">
          {oneDay(e)
            ? `Один день, с ${hhmm(e.starts_at)} до ${endsAt(e)}.`
            : `${e.days} ${plural(e.days, 'день', 'дня', 'дней')}, каждый с ${
                hhmm(e.starts_at)} до ${endsAt(e)}.`}{' '}
          {who}
          {e.age_hint ? `, ${e.age_hint}` : ''}.
          {e.capacity ? ` В день берут не больше ${e.capacity} человек.` : ''}
        </p>

        <div className="sked">
          <div className="sked-row">
            <div className="sked-days">{days(e)}</div>
            <div className="sked-time">{hours(e)}</div>
            <div className="sked-what">
              {period(e)}
              <span className="sked-tag">Только по записи</span>
              <span className="sked-note">
                Приходить можно не на все дни: отмечаете в кабинете те, которые
                нужны.
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/**
 * Цены одной смены. Стоят в конце страницы: сначала человек понимает,
 * что это за смена и как она выглядит, и только потом считает деньги.
 */
function Prices({ e }: { e: PublicEvent }) {
  const day = Number(e.price);

  return (
    <div style={{ marginBottom: 12 }}>
      <div className="prices">
        <div className="price">
          <div className="price-kind">Один день</div>
          <div className="price-sum">{day} <span>₪</span></div>
          <p className="price-desc">
            Платится за тот день, в который ребёнок пришёл. Ничего покупать
            заранее не нужно.
          </p>
        </div>

        {(e.pass_offers ?? []).map((o) => (
          <div className="price" key={o.lessons}>
            <div className="price-kind">
              Пакет · {o.lessons} {plural(o.lessons, 'день', 'дня', 'дней')}
            </div>
            <div className="price-sum">{o.price} <span>₪</span></div>
            <div className="price-per">
              {money(Math.round(o.price / o.lessons), 'ILS')} за день
              {o.price < day * o.lessons
                ? ` · экономия ${money(day * o.lessons - o.price, 'ILS')}`
                : ''}
            </div>
            <p className="price-desc">
              Действует до {dayMonth(e.ends_on)}. Неиспользованные дни сгорают.
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
