import { isAdmin, requireTeacher } from '@/lib/session';
import { photoOf } from '@/lib/expenses';

export const dynamic = 'force-dynamic';

/**
 * Снимок чека. Лежит в базе, наружу отдаётся только админу: на чеке видны
 * карта и адрес, и прямой ссылкой на картинку делиться не с кем.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const user = await requireTeacher();
  if (!isAdmin(user)) return new Response('нет', { status: 403 });

  const { id } = await params;
  const photo = await photoOf(id);
  if (!photo) return new Response('нет снимка', { status: 404 });

  return new Response(new Uint8Array(photo.bytes), {
    headers: {
      'content-type': photo.type,
      // Приватное и неизменное: браузеру можно держать, общим кэшам нельзя.
      'cache-control': 'private, max-age=86400',
    },
  });
}
