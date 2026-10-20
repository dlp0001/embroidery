import Link from 'next/link';
import { inviteLook } from '@/lib/family';
import { formStamp } from '@/lib/form-guard';
import { currentUser } from '@/lib/session';
import NotConfigured from '@/components/NotConfigured';
import JoinForm from './JoinForm';
import { joinAsMe } from './actions';

export const dynamic = 'force-dynamic';

/**
 * Приглашение второму родителю. Ссылку присылает первый, из профиля.
 *
 * Детей показываем по именам: человек должен видеть, в какую семью его
 * зовут, прежде чем оставлять свою почту.
 */
export default async function JoinPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  if (!process.env.DATABASE_URL) return <NotConfigured />;
  const [{ token }, { error }] = await Promise.all([params, searchParams]);
  const invite = await inviteLook(token);
  const user = await currentUser();

  return (
    <main className="app">
      <div className="top">
        <div className="kicker">Re.Create.Art · Студия</div>
        <h1 className="h1">{invite ? 'Второй родитель' : 'Ссылка не годится'}</h1>
        {invite && (
          <p className="sub">
            {invite.inviter} открывает вам кабинет
            {invite.children.length > 0
              ? `: ${invite.children.join(', ')}`
              : ''}
          </p>
        )}
      </div>

      <div className="body">
        {!invite ? (
          <div className="card">
            <p className="sub" style={{ marginBottom: 14 }}>
              Эта ссылка одноразовая и живёт неделю. Похоже, ею уже вошли или
              она устарела.
            </p>
            <p className="hint">
              Попросите прислать новую — она делается в профиле, кнопкой
              «Пригласить второго родителя». Если кабинет у вас уже есть,
              просто <Link href="/login" className="linky">войдите</Link>.
            </p>
          </div>
        ) : user && user.id === invite.inviter_id ? (
          <div className="card">
            <p className="sub" style={{ marginBottom: 14 }}>
              Это ваша же ссылка. Отправьте её второму родителю — открыть её
              должен он.
            </p>
            <Link href="/account/profile" className="btn">В профиль</Link>
          </div>
        ) : user ? (
          <div className="card">
            <p className="sub" style={{ marginBottom: 6 }}>
              Вы вошли как {user.name ?? user.email}.
            </p>
            <p className="hint" style={{ marginBottom: 16 }}>
              {invite.children.length > 0
                ? `В вашем кабинете появятся: ${invite.children.join(', ')}.`
                : 'Кабинет станет общим.'}
            </p>
            {error && <p className="err">Ссылка больше не годится. Попросите новую.</p>}
            <form action={joinAsMe}>
              <input type="hidden" name="token" value={token} />
              <button className="btn" type="submit">Принять приглашение</button>
            </form>
          </div>
        ) : (
          <div className="card">
            <JoinForm token={token} stamp={formStamp()} />
          </div>
        )}
      </div>
    </main>
  );
}
