import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default async function DonePage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string }>;
}) {
  const { ok } = await searchParams;
  const good = ok === '1';

  return (
    <>
      <div className="top">
        <div className="kicker">Re.Create.Art · Студия</div>
        <h1 className="h1">{good ? 'Оплачено' : 'Платёж не прошёл'}</h1>
      </div>
      <div className="body">
        <p className="hint">
          {good
            ? 'Спасибо. Занятия и остаток абонемента обновятся в течение минуты, как только придёт подтверждение от банка.'
            : 'Деньги не списаны. Можно попробовать ещё раз или рассчитаться на занятии.'}
        </p>
        <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
          <Link className="btn" href="/account/pay">К оплате</Link>
          <Link className="btn-quiet" href="/account">В кабинет</Link>
        </div>
      </div>
    </>
  );
}
