import { redirect } from 'next/navigation';
import Tabs, { type Tab } from '@/components/Tabs';
import SignOut from '@/components/SignOut';
import NotConfigured from '@/components/NotConfigured';
import PeekSwitch from '@/components/PeekSwitch';
import { actingAs, canTeach, currentUser, realUser } from '@/lib/session';
import { cabinetOwners } from '@/lib/studio';
import { stopViewAction, viewAsAction } from '@/app/admin/view-actions';

const TABS: Tab[] = [
  { href: '/account', icon: 'week', label: 'Неделя' },
  { href: '/account/calendar', icon: 'cal', label: 'Календарь' },
  { href: '/account/history', icon: 'hist', label: 'История' },
  { href: '/account/pay', icon: 'pay', label: 'Оплата' },
  { href: '/account/profile', icon: 'person', label: 'Профиль' },
];

export default async function AccountLayout({ children }: { children: React.ReactNode }) {
  if (!process.env.DATABASE_URL) return <NotConfigured />;
  const user = await currentUser();
  if (!user) redirect('/login');
  // Суперадмин смотрит чужой кабинет: подписываем, чей он, и оставляем
  // дорогу назад. Без полосы легко решить, что это твои долги и дети.
  const peek = await actingAs();
  // Список кабинетов нужен только в режиме просмотра: обычному родителю
  // незачем ни список, ни лишний запрос.
  const me = peek ? await realUser() : null;
  const owners = peek
    ? (await cabinetOwners()).filter((o) => o.id !== me?.id)
    : [];

  return (
    <div className="app">
      {peek && (
        <div className="peek">
          <span>
            Кабинет:{' '}
            {owners.length > 1
              ? <PeekSwitch action={viewAsAction} people={owners} current={peek.id} />
              : <b style={{ color: 'var(--charcoal)' }}>{peek.name ?? peek.email}</b>}
          </span>
          <form action={stopViewAction}>
            <button className="linky" type="submit">Вернуться к себе</button>
          </form>
          <span className="peek-note">только смотрите, менять ничего нельзя</span>
        </div>
      )}
      {children}
      {/* В чужом кабинете «Выйти» значило бы «выйти совсем»: вместо него
          второй выход из просмотра, внизу страницы, где его и ищут. */}
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
        <SignOut
          email={user.email}
          cross={canTeach(user) ? { href: '/admin/studio', label: 'Журнал преподавателя' } : undefined}
        />
      )}
      <Tabs tabs={TABS} />
    </div>
  );
}
