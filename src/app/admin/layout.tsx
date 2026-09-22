import { redirect } from 'next/navigation';
import Tabs, { type Tab } from '@/components/Tabs';
import SignOut from '@/components/SignOut';
import NotConfigured from '@/components/NotConfigured';
import { canTeach, currentUser, isAdmin } from '@/lib/session';

const TABS: Tab[] = [
  { href: '/admin/studio', icon: 'week', label: 'Сегодня' },
  { href: '/admin/studio/calendar', icon: 'cal', label: 'Расписание' },
  { href: '/admin/studio/groups', icon: 'groups', label: 'Группы' },
  { href: '/admin/studio/people', icon: 'person', label: 'Люди' },
  { href: '/admin/studio/debts', icon: 'pay', label: 'Финансы' },
];

/** Закладка для того, что делают изредка и всей студии сразу. */
const ADMIN_TAB: Tab = { href: '/admin/studio/admin', icon: 'tool', label: 'Админ' };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  if (!process.env.DATABASE_URL) return <NotConfigured />;
  const user = await currentUser();
  if (!user) redirect('/login');
  if (!canTeach(user)) redirect('/account');
  return (
    <div className="app">
      {children}
      <SignOut email={user.email} cross={{ href: '/account', label: 'Мой кабинет' }} />
      <Tabs tabs={isAdmin(user) ? [...TABS, ADMIN_TAB] : TABS} />
    </div>
  );
}
