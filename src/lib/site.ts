import { headers } from 'next/headers';

/**
 * Адрес сайта из самого запроса, чтобы ссылки совпадали и на превью, и на
 * проде. Отдельной переменной окружения нет нарочно: одну забыли бы
 * поменять, и письма с ботом стали бы водить не туда.
 */
export async function siteOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:4321';
  // Расписание зовёт нас по адресу самой выкладки, и ссылка из сообщения
  // вела бы на ...vercel.app: там своя кука, и родителю пришлось бы
  // входить заново. У таких вызовов берём постоянный адрес проекта — его
  // подставляет сам хостинг, поэтому он не устареет при переезде.
  const project = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (project && /\.vercel\.app$/.test(host)) return `https://${project}`;
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
}
