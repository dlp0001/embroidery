import Link from 'next/link';
import { logoutAction } from '@/app/login/actions';

/** Подвал кабинета: кто вошёл, переход в соседний раздел и выход. */
export default function SignOut({
  email,
  cross,
}: {
  email: string;
  cross?: { href: string; label: string };
}) {
  return (
    <div style={{ padding: '18px 20px 24px', display: 'flex', flexDirection: 'column', gap: 14 }}>
      {cross && (
        <Link className="btn-quiet" href={cross.href} style={{ justifyContent: 'center' }}>
          {cross.label}
        </Link>
      )}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <span style={{ fontSize: 12.5, color: 'var(--warm-gray)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {email}
        </span>
        <form action={logoutAction}>
          <button className="btn-quiet" type="submit">Выйти</button>
        </form>
      </div>
    </div>
  );
}
