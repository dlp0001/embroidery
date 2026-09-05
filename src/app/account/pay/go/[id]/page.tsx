import Link from 'next/link';
import { notFound } from 'next/navigation';
import { checkoutUrl } from '@/lib/billing';
import { requireUser } from '@/lib/session';

export const dynamic = 'force-dynamic';

/**
 * Промежуточная страница к кассе PayPlus. Уводит сама, но если браузер
 * почему-то не ушёл, остаётся видимая кнопка — человек не застревает.
 */
export default async function GoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const url = await checkoutUrl(id, user.id);
  if (!url) notFound();

  return (
    <>
      <div className="top">
        <div className="kicker">Re.Create.Art · Студия</div>
        <h1 className="h1">Переходим к оплате</h1>
      </div>
      <div className="body">
        <p className="hint">Открываем защищённую страницу банка. Если ничего не произошло, нажмите кнопку.</p>
        <a className="btn-wide" href={url} style={{ marginTop: 20 }}>Перейти к оплате</a>
        <p className="hint" style={{ marginTop: 16 }}>
          <Link href="/account/pay">Вернуться</Link>
        </p>
        <script
          dangerouslySetInnerHTML={{
            __html: `window.location.replace(${JSON.stringify(url)})`,
          }}
        />
      </div>
    </>
  );
}
