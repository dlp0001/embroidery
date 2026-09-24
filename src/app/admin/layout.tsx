import { redirect } from 'next/navigation';
import Tabs, { type Tab } from '@/components/Tabs';
import SignOut from '@/components/SignOut';
import NotConfigured from '@/components/NotConfigured';
import PeekBar from '@/components/PeekBar';
import { actingAs, canTeach, currentUser, isAdmin, realUser } from '@/lib/session';
import { cabinetOwners } from '@/lib/studio';
import { stopViewAction } from '@/app/admin/view-actions';

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

  // Журнал тоже можно смотреть чужими глазами: у Вари он свой, и видеть
  // его таким, какой он у неё, полезнее, чем расспрашивать.
  const peek = await actingAs();
  const me = peek ? await realUser() : null;
  const owners = peek
    ? (await cabinetOwners()).filter((o) => o.id !== me?.id)
    : [];

  return (
    <div className="app">
      {peek && (
        <PeekBar peek={peek} owners={owners}
                 cross={isAdmin(peek) ? undefined : { href: '/account', label: 'Кабинет' }} />
      )}
      {children}
      {/* В чужих глазах «Выйти» значило бы «выйти совсем»: вместо него
          выход из просмотра. */}
      {peek ? (
        <div style={{ padding: '18px 20px 24px' }}>
          <form action={stopViewAction}>
            <button className="btn-quiet" type="submit"
                    style={{ width: '100%', justifyContent: 'center' }}>
              Вернуться в свой кабинет
            </button>
          </form>
        </div>
      ) : (
        <SignOut email={user.email} />
      )}
      <Tabs tabs={isAdmin(user) ? [...TABS, ADMIN_TAB] : TABS} />
    </div>
  );
}
