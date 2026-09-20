import { redirect } from 'next/navigation';
import { canTeach, currentUser } from '@/lib/session';
import NotConfigured from '@/components/NotConfigured';
import LoginForm from './LoginForm';

export default async function LoginPage() {
  if (!process.env.DATABASE_URL) return <NotConfigured />;
  const user = await currentUser();
  if (user) redirect(canTeach(user) ? '/admin/studio' : '/account');
  return (
    <main className="app">
      <div className="top">
        <div className="kicker">Re.Create.Art</div>
        <h1 className="h1">Вход</h1>
      </div>
      <div className="body">
        <LoginForm />
      </div>
    </main>
  );
}
