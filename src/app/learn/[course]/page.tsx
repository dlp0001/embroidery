import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { courseAccess, courseBySlug, lessonsWithPlayers, longDate } from '@/lib/course';
import Shell from '../Shell';
import RequestLinkForm from '../RequestLinkForm';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Курс по вышивке · Re.Create.Art',
  robots: { index: false, follow: false },
};

/**
 * Курс. Уроки и подписанные ссылки на видео отдаются только браузеру,
 * который открыл курс по личной ссылке из письма, или родителю студии,
 * вошедшему в кабинет с той же почтой. Остальным — форма, куда ввести
 * почту покупателя.
 */
export default async function CoursePage({ params }: { params: Promise<{ course: string }> }) {
  const { course: slug } = await params;
  const course = await courseBySlug(slug);
  if (!course) notFound();

  const access = await courseAccess(course);

  if (!access) {
    return (
      <Shell side={<a href="/embroidery">О курсе</a>}>
        <div className="gate">
          <div className="gate-card">
            <div className="gate-kicker">Курс по вышивке</div>
            <h1 className="gate-title">{course.title}</h1>
            <p className="gate-text">
              Курс открывается по личной ссылке из письма, которое пришло после оплаты.
            </p>
            <p className="gate-text">
              Потеряли письмо или открываете на новом устройстве? Введите почту, с которой
              покупали, — пришлём свежую ссылку.
            </p>
            <RequestLinkForm course={course.slug} />
            {/* Ссылки на вход здесь нарочно нет: вход создаёт кабинет студии,
                а покупателю курса он не нужен. Родители студии и так знают,
                где их кабинет. */}
            <p className="gate-note">
              Ходите в студию? Войдите в кабинет студии с той же почтой, с которой покупали
              курс, — он откроется сам, без ссылки.
            </p>
            <p className="gate-note">
              Ещё не купили? <a href="/embroidery">Всё о курсе</a>
            </p>
          </div>
        </div>
      </Shell>
    );
  }

  if (access.expired) {
    return (
      <Shell side={<a href="/embroidery">О курсе</a>}>
        <div className="gate">
          <div className="gate-card">
            <div className="gate-kicker">{course.title}</div>
            <h1 className="gate-title">Срок доступа закончился</h1>
            <p className="gate-text">Доступ был открыт до {longDate(access.until)}.</p>
            <a className="btn" href="/embroidery">Купить курс снова</a>
          </div>
        </div>
      </Shell>
    );
  }

  const lessons = await lessonsWithPlayers(course.id);

  return (
    <Shell side={<a href={`/learn/${course.slug}/materials`}>Материалы</a>}>
      <section className="hero">
        <div className="hero-inner">
          <div className="hero-label">Курс по вышивке · Видеоуроки</div>
          <h1 className="hero-title">{course.title}</h1>
          <p className="hero-desc">
            Смотрите в удобное время, ставьте на паузу, пересматривайте сколько угодно.
          </p>
          <div className="hero-until">Доступ до {longDate(access.until)}</div>
        </div>
      </section>

      <div className="content">
        <div className="materials">
          <div>
            <div className="materials-title">Материалы и инструменты</div>
            <div className="materials-sub">Полный список с ссылками, где купить: Россия, Израиль и остальной мир.</div>
          </div>
          <a className="btn" href={`/learn/${course.slug}/materials`}>Открыть список</a>
        </div>

        <div className="section-label">Уроки</div>
        <h2 className="section-title">Смотрите в удобное <em>время</em></h2>

        {lessons.map((l) => (
          <div className="video-card" key={l.slug}>
            <div className="video-header">
              <div className="video-num">{String(l.position).padStart(2, '0')}</div>
              <div className="video-title">{l.title}</div>
            </div>
            {l.embed && (
              <div className="video-player">
                <iframe
                  src={l.embed}
                  title={l.title}
                  loading="lazy"
                  allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture; fullscreen"
                  allowFullScreen
                />
              </div>
            )}
            {l.description && <div className="video-desc">{l.description}</div>}
          </div>
        ))}
      </div>
    </Shell>
  );
}
