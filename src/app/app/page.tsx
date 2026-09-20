import { redirect } from 'next/navigation';
import { canTeach, currentUser } from '@/lib/session';
import NotConfigured from '@/components/NotConfigured';

export const dynamic = 'force-dynamic';

/**
 * Вход в приложение. Сюда ведёт ярлык на телефоне, и отсюда каждый
 * попадает туда, где ему работать: Варя и админы — в журнал, родители —
 * в свой кабинет. Свой кабинет у Вари никуда не делся, в него ведёт
 * ссылка из журнала.
 */
export default async function AppEntry() {
  if (!process.env.DATABASE_URL) return <NotConfigured />;
  const user = await currentUser();
  if (!user) redirect('/login');
  redirect(canTeach(user) ? '/admin/studio' : '/account');
}
