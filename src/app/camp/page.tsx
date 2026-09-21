import type { Metadata } from 'next';
import { publicEvents, type PublicEvent } from '@/lib/studio';
import { dayMonth, hhmm, money, plural } from '@/lib/format';
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

export default async function CampPage() {
  const events = await publicEvents();
  const camp = events.find((e) => e.kind === 'camp') ?? events[0] ?? null;

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
              ? `Целый день в студии вместо трёх часов: ${period(camp)}. Те же материалы, те же инструменты и время, которого обычно не хватает, чтобы довести идею до вещи.`
              : 'Варя ведёт творческие занятия в студии и в детских лагерях. Даты ближайшей смены появятся здесь.'}
          </p>
          <a href={camp ? '/login' : 'mailto:info@re-create.art'} className="hero-cta">
            {camp ? 'Записаться в кабинете' : 'Написать Варе'}
          </a>
        </div>
        <div className="hero-right">
          <img src="/studio.jpg" alt="Творческое занятие в студии" />
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
        <section className="wrap">
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
                абонемент студии в лагере не работает, и наоборот. Неиспользованные
                дни сгорают вместе со сменой.
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
              <div className="rule-t">Обычных занятий в эти дни нет</div>
              <p className="rule-d">
                В дни смены студия занята лагерем целиком: обычное расписание
                на это время не действует и в кабинете не показывается.
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
              <div className="rule-t">Оплата</div>
              <p className="rule-d">
                Картой, Apple Pay или Google Pay, битом, пейбоксом или наличными.
                Пакет покупается в кабинете или у Вари.
              </p>
            </div>
          </div>
        </section>
      )}

      <section className="wrap wrap-tint">
        <div className="inner">
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

/** Одна смена: когда она идёт и сколько стоит. */
function Event({ e, tinted }: { e: PublicEvent; tinted: boolean }) {
  const day = Number(e.price);
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
          {e.capacity ? ` Мест ${e.capacity}.` : ''}
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

        <p className="after">
          Пакет покупается в кабинете или у Вари. Сколько дней в нём осталось —
          видно там же.
        </p>
      </div>
    </section>
  );
}
