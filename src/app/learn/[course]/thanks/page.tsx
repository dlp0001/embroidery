import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { courseBySlug } from '@/lib/course';
import Shell from '../../Shell';
import RequestLinkForm from '../../RequestLinkForm';

export const metadata: Metadata = {
  title: 'Спасибо · Re.Create.Art',
  robots: { index: false, follow: false },
};

/**
 * Сюда касса возвращает покупателя. Сам возврат ничего не открывает:
 * доступ даёт вебхук, когда касса подтвердит платёж, и письмо со ссылкой
 * уходит оттуда же.
 */
export default async function ThanksPage({ params }: { params: Promise<{ course: string }> }) {
  const { course: slug } = await params;
  const course = await courseBySlug(slug);
  if (!course) notFound();

  return (
    <Shell side={<a href="/embroidery">О курсе</a>}>
      <div className="gate">
        <div className="gate-card">
          <div className="gate-kicker">{course.title}</div>
          <h1 className="gate-title">Спасибо!</h1>
          <p className="gate-text">
            Как только касса подтвердит оплату, на вашу почту придёт письмо с личной ссылкой
            на курс. Обычно это пара минут.
          </p>
          <p className="gate-text">
            Не пришло за четверть часа? Загляните в «Промоакции» и «Спам» или попросите
            ссылку ещё раз:
          </p>
          <RequestLinkForm course={course.slug} button="Прислать ссылку ещё раз" />
        </div>
      </div>
    </Shell>
  );
}
