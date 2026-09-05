import { logoutAction } from '@/app/login/actions';

export default function SignOut({ email }: { email: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '18px 20px 24px' }}>
      <span style={{ fontSize: 12.5, color: 'var(--warm-gray)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {email}
      </span>
      <form action={logoutAction}>
        <button className="btn-quiet" type="submit">Выйти</button>
      </form>
    </div>
  );
}
