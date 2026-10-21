import { checkInitData, initDataFromHeader, miniappReady } from '@/lib/tg-miniapp';
import { chatUser, isStudioAdmin, isTeacher } from '@/lib/telegram';
import { pulse } from '@/lib/tg-stats';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Числа для мини-приложения. Кто спрашивает — решает подпись телеграма,
 * а не кука сайта: страница открыта внутри телеграма, и своего входа у
 * неё нет.
 *
 * Отвечаем только Варе и админам. Родителю тут делать нечего: его
 * собственные занятия и оплаты живут в кабинете, а чужие деньги не его
 * дело. Поэтому отказ один и тот же и на «подпись не сошлась», и на
 * «роль не та»: по разнице ответов чужой понял бы, что подпись принята.
 */
export async function GET(req: Request): Promise<Response> {
  if (!miniappReady()) {
    return Response.json({ error: 'бот не настроен' }, { status: 503 });
  }

  const visitor = checkInitData(initDataFromHeader(req));
  const user = visitor ? await chatUser(visitor.tgId) : null;
  const allowed = user
    ? (await isStudioAdmin(user.id)) || (await isTeacher(user.id))
    : false;
  if (!allowed) {
    console.warn('miniapp: отказ', visitor ? `tg ${visitor.tgId}` : 'подпись не сошлась');
    return Response.json({ error: 'нет доступа' }, { status: 403 });
  }

  return Response.json({ name: user?.name ?? null, ...(await pulse()) });
}
