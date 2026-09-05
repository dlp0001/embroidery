import { redirect } from 'next/navigation';
import Tabs, { type Tab } from '@/components/Tabs';
import SignOut from '@/components/SignOut';
import NotConfigured from '@/components/NotConfigured';
import { canTeach, currentUser } from '@/lib/session';

const TABS: Tab[] = [
  { href: '/account', icon: 'week', label: 'Неделя' },
  { href: '/account/calendar', icon: 'cal', label: 'Календарь' },
  { href: '/account/history', icon: 'hist', label: 'История' },
  { href: '/account/profile', icon: 'person', label: 'Профиль' },
];

export default async function AccountLayout({ children }: { children: React.ReactNode }) {
  if (!process.env.DATABASE_URL) return <NotConfigured />;
  const user = await currentUser();
  if (!user) redirect('/login');
  return (
    <div className="app">
      {children}
      <SignOut
        email={user.email}
        cross={canTeach(user) ? { href: '/admin/studio', label: 'Журнал преподавателя' } : undefined}
      />
      <Tabs tabs={TABS} />
    </div>
  );
}
