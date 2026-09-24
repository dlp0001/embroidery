import { headers } from 'next/headers';

/**
 * Адрес сайта из самого запроса, чтобы ссылки совпадали и на превью, и на
 * проде. Отдельной переменной окружения нет нарочно: одну забыли бы
 * поменять, и письма с ботом стали бы водить не туда.
 */
export async function siteOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:4321';
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
}
