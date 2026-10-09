import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { courseBySlug, deviceAccess, linkInfo, longDate, maskEmail } from '@/lib/course';
import Shell from '../../Shell';
import RequestLinkForm from '../../RequestLinkForm';
import OpenForm from './OpenForm';

export const metadata: Metadata = {
  title: 'Курс · Re.Create.Art',
  robots: { index: false, follow: false },
};

/**
 * Ссылка из письма. Сама страница ничего не меняет — устройство заводит
 * кнопка, см. openCourseAction. Если этот браузер уже открывал курс,
 * кнопка не нужна: сразу к урокам.
 */
export default async function LinkPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const info = await linkInfo(token);

  if (info && !info.expired) {
    const course = await courseBySlug(info.slug);
    const here = course ? await deviceAccess(course) : null;
    if (here?.id === info.accessId) redirect(`/learn/${info.slug}`);
  }

  return (
    <Shell>
      <div className="gate">
        <div className="gate-card">
          {!info ? (
            <>
              <div className="gate-kicker">Курс по вышивке</div>
              <h1 className="gate-title">Ссылка устарела</h1>
              <p className="gate-text">
                Вместо неё уже отправлена новая — или ссылку скопировали не целиком.
                Введите почту, с которой покупали курс, и мы пришлём свежую.
              </p>
              <RequestLinkForm course="embroidery" />
            </>
          ) : info.expired ? (
            <>
              <div className="gate-kicker">{info.title}</div>
              <h1 className="gate-title">Срок доступа закончился</h1>
              <p className="gate-text">
                Доступ для {maskEmail(info.email)} был открыт до {longDate(info.until)}.
              </p>
              <a className="btn" href="/embroidery">Купить курс снова</a>
            </>
          ) : (
            <>
              <div className="gate-kicker">{info.title}</div>
              <h1 className="gate-title">Ваш доступ к курсу</h1>
              <p className="gate-text">
                Для {maskEmail(info.email)}, до {longDate(info.until)}. Нажмите кнопку — этот
                браузер запомнит доступ, и дальше курс будет открываться сам.
              </p>
              <OpenForm token={token} course={info.slug} />
            </>
          )}
        </div>
      </div>
    </Shell>
  );
}
