import { redirect } from 'next/navigation';
import Tabs, { type Tab } from '@/components/Tabs';
import SignOut from '@/components/SignOut';
import { canTeach, currentUser } from '@/lib/session';

const TABS: Tab[] = [
  { href: '/admin/studio', icon: 'cal', label: 'Сегодня' },
  { href: '/admin/studio/groups', icon: 'groups', label: 'Группы' },
  { href: '/admin/studio/debts', icon: 'pay', label: 'Долги' },
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  if (!user) redirect('/login');
  if (!canTeach(user)) redirect('/account');
  return (
    <div className="app">
      {children}
      <SignOut email={user.email} />
      <Tabs tabs={TABS} />
    </div>
  );
}
