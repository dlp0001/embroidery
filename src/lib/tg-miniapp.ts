import { createHmac, timingSafeEqual } from 'node:crypto';
import { chatUser, isStudioAdmin, isTeacher } from './telegram';

/**
 * Мини-приложение телеграма: страница сайта, открытая внутри телеграма.
 * Вход в неё не по коду и не по куке, а по подписи: телеграм отдаёт
 * странице строку initData, подписанную ботовым токеном, и в ней лежит
 * id того, кто открыл.
 *
 * Проверять подпись обязательно. initData приходит из браузера, то есть
 * его можно написать руками; без проверки «статистику студии» открыл бы
 * кто угодно, подставив чужой id.
 */

/**
 * Сколько живёт подпись. Телеграм обновляет initData при открытии, так
 * что сутки это запас на вкладку, оставленную открытой с вечера.
 */
const MAX_AGE_SEC = 24 * 60 * 60;

export type TgVisitor = { tgId: number; name: string | null };

export function miniappReady(): boolean {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN);
}

/**
 * Проверка по алгоритму телеграма: пары «ключ=значение», кроме самой
 * подписи, сортируются по ключу и склеиваются через перевод строки;
 * ключ подписи — HMAC от токена бота со словом WebAppData.
 *
 * null — подпись не сошлась, протухла или в данных нет человека. Почему
 * именно, наружу не говорим: это подсказка тому, кто подбирает.
 */
export function checkInitData(initData: string | null): TgVisitor | null {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || !initData) return null;

  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');

  const check = [...params.entries()]
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  const mine = createHmac('sha256', secret).update(check).digest('hex');

  // Побайтно и за постоянное время: обычное сравнение строк отвечает тем
  // быстрее, чем раньше разошлись байты, и по этому подпись подбирают.
  const a = Buffer.from(mine, 'hex');
  const b = Buffer.from(hash, 'hex');
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  const authDate = Number(params.get('auth_date') ?? 0);
  if (!authDate || Date.now() / 1000 - authDate > MAX_AGE_SEC) return null;

  try {
    const user = JSON.parse(params.get('user') ?? 'null');
    if (!user?.id) return null;
    const name = [user.first_name, user.last_name].filter(Boolean).join(' ') || null;
    return { tgId: Number(user.id), name };
  } catch {
    return null;
  }
}

/** Как телеграм просит присылать подпись: заголовок «Authorization: tma …». */
export function initDataFromHeader(req: Request): string | null {
  const auth = req.headers.get('authorization') ?? '';
  return auth.startsWith('tma ') ? auth.slice(4) : null;
}

export type MiniUser = { id: string; name: string | null; admin: boolean };

/**
 * Кто открыл экран мини-приложения. null — подпись не сошлась, человека
 * нет в студии или роль не та; какое из трёх, наружу не говорим: по
 * разнице ответов чужой понял бы, что подпись у него приняли.
 *
 * admin — деньги кассы: кто должен, когда придут выплаты. У Вари эта
 * роль есть, у преподавателя без неё — нет.
 */
export async function miniappUser(req: Request): Promise<MiniUser | null> {
  const visitor = checkInitData(initDataFromHeader(req));
  const user = visitor ? await chatUser(visitor.tgId) : null;
  if (!user) {
    console.warn('miniapp: отказ', visitor ? `tg ${visitor.tgId}` : 'подпись не сошлась');
    return null;
  }
  const [admin, teacher] = await Promise.all([isStudioAdmin(user.id), isTeacher(user.id)]);
  if (!admin && !teacher) {
    console.warn('miniapp: отказ, роль не та —', user.name ?? user.id);
    return null;
  }
  return { id: user.id, name: user.name, admin };
}
