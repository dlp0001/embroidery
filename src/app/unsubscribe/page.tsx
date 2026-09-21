import type { Metadata } from 'next';
import { isOptedOut, tokenOk } from '@/lib/mail';
import { optInAction, optOutAction } from './actions';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Отказ от рассылки · Re.Create.Art',
  robots: { index: false, follow: false },
};

export default async function UnsubscribePage({
  searchParams,
}: {
  searchParams: Promise<{ e?: string; t?: string; done?: string; back?: string; bad?: string }>;
}) {
  const { e, t, done, back, bad } = await searchParams;
  const email = (e ?? '').trim().toLowerCase();
  const valid = email !== '' && t !== undefined && tokenOk(email, t);

  // Отписаться можно и мимо этой страницы: в Gmail своя кнопка сверху
  // письма. Тогда человек приходит сюда по ссылке из того же письма, и
  // предлагать ему «отказаться» второй раз незачем — ему нужен возврат.
  const already = valid && !done && !back ? await isOptedOut(email) : false;

  const title = done ? 'Больше не напишем'
    : back ? 'С возвращением'
    : already ? 'Вы не в рассылке'
    : 'Отказ от рассылки';

  return (
    <main className="app">
      <div className="top">
        <div className="kicker">Re.Create.Art</div>
        <h1 className="h1">{title}</h1>
      </div>

      <div className="body">
        {!valid || bad ? (
          <p className="note">
            Ссылка не подошла, наверное, почтовик её обрезал. Напишите на{' '}
            <a href="mailto:info@re-create.art">info@re-create.art</a>, и мы
            уберём адрес из рассылки руками.
          </p>
        ) : back ? (
          <p className="note">
            Адрес {email} снова в рассылке. Письма про смены и расписание будут
            приходить как раньше.
          </p>
        ) : done || already ? (
          <>
            <p className="note">
              {done
                ? `Адрес ${email} выведен из общей рассылки. Письма про лагерь, новое
                   расписание и прочие новости на него больше не придут.`
                : `Адрес ${email} уже выведен из общей рассылки. Письма про лагерь и
                   расписание на него не приходят.`}
            </p>
            <p className="note" style={{ marginTop: 10 }}>
              Код для входа в кабинет и квитанции об оплате приходить не
              перестанут: это письма про ваши занятия и деньги, а не рассылка.
            </p>
            <form action={optInAction} style={{ marginTop: 16 }}>
              <input type="hidden" name="email" value={email} />
              <input type="hidden" name="token" value={t} />
              <button type="submit" className="btn-quiet">
                {done ? 'Я нажал случайно, верните' : 'Вернуть меня в рассылку'}
              </button>
            </form>
          </>
        ) : (
          <>
            <p className="note">
              Убрать {email} из общей рассылки? Письма про смены и расписание
              на него приходить перестанут. Код для входа в кабинет и квитанции
              об оплате будут приходить как приходили.
            </p>
            <form action={optOutAction} style={{ marginTop: 16 }}>
              <input type="hidden" name="email" value={email} />
              <input type="hidden" name="token" value={t} />
              <button type="submit" className="btn-wide">Отказаться</button>
            </form>
          </>
        )}
      </div>
    </main>
  );
}
