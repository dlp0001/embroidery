import Link from 'next/link';
import { verifyPending } from '@/lib/billing';
import { requireUser } from '@/lib/session';

export const dynamic = 'force-dynamic';

/**
 * Куда PayPlus возвращает человека после кассы. Мы не ждём обратного
 * вызова и не верим строке запроса: сами спрашиваем у PayPlus, что
 * случилось с платежом, и только потом что-то пишем на экране.
 */
export default async function DonePage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string }>;
}) {
  const user = await requireUser();
  const { ok } = await searchParams;
  const check = await verifyPending(user.id);

  const good = check.paid > 0 || (ok === '1' && check.failed === 0);
  const title = check.paid > 0 ? 'Оплачено'
    : check.failed > 0 ? 'Платёж не прошёл'
    : ok === '1' ? 'Ждём подтверждения'
    : 'Платёж не прошёл';

  const text = check.paid > 0
    ? 'Спасибо, деньги дошли. Занятия и остаток абонемента уже обновились.'
    : check.failed > 0
      ? 'Банк не провёл платёж, деньги не списаны. Можно попробовать ещё раз или рассчитаться на занятии.'
      : ok === '1'
        ? 'Банк ещё не ответил окончательно. Обновите страницу через минуту: если деньги дошли, занятия закроются сами.'
        : 'Деньги не списаны. Можно попробовать ещё раз или рассчитаться на занятии.';

  return (
    <>
      <div className="top">
        <div className="kicker">Re.Create.Art · Студия</div>
        <h1 className="h1">{title}</h1>
      </div>
      <div className="body">
        <p className="hint">{text}</p>
        <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
          <Link className="btn" href="/account/pay">К оплате</Link>
          <Link className="btn-quiet" href="/account">В кабинет</Link>
        </div>
        {!good && check.waiting > 0 && (
          <p className="hint" style={{ marginTop: 18 }}>
            Если списание всё-таки было, напишите на{' '}
            <a href="mailto:info@re-create.art">info@re-create.art</a>: разберёмся вручную.
          </p>
        )}
      </div>
    </>
  );
}
