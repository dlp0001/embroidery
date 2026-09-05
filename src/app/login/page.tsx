import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/session';
import LoginForm from './LoginForm';

export default async function LoginPage() {
  if (await currentUser()) redirect('/account');
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
