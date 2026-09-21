import { optOut, tokenOk } from '@/lib/mail';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Кнопка «отписаться» самого почтовика (RFC 8058, one-click): Gmail и
 * прочие сами шлют сюда POST, без участия человека. Поэтому здесь только
 * POST: по GET ссылку открывают сканеры писем, и люди отписывались бы
 * молча. Человеку с кнопкой в тексте письма отвечает страница /unsubscribe.
 */
export async function POST(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const email = (searchParams.get('e') ?? '').trim().toLowerCase();
  const token = searchParams.get('t') ?? '';
  if (!email || !tokenOk(email, token)) {
    return new Response('bad token', { status: 400 });
  }
  try {
    await optOut(email);
  } catch (err) {
    console.error('unsubscribe:', err);
    return new Response('database error', { status: 500 });
  }
  return new Response('unsubscribed', { status: 200 });
}
