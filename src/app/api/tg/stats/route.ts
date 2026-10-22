import { miniappReady, miniappUser } from '@/lib/tg-miniapp';
import { pulse } from '@/lib/tg-stats';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Числа для экрана «Как дела». Кто спрашивает — решает подпись телеграма,
 * а не кука сайта: страница открыта внутри телеграма, и своего входа у
 * неё нет. Отвечаем Варе и админам, родителю здесь делать нечего.
 */
export async function GET(req: Request): Promise<Response> {
  if (!miniappReady()) return Response.json({ error: 'бот не настроен' }, { status: 503 });

  const user = await miniappUser(req);
  if (!user) return Response.json({ error: 'нет доступа' }, { status: 403 });

  return Response.json({ name: user.name, ...(await pulse()) });
}
