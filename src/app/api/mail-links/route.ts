import { cronRights, describeAuth } from '@/lib/cron-auth';
import { unsubToken } from '@/lib/mail';
import { linkUrl } from '@/lib/telegram';

export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

/**
 * Подписанные ссылки для рассылки: отказ от писем и привязка к боту.
 *
 * Нужен затем, чтобы подпись была одна. Раньше их считал скрипт рассылки
 * на ноутбуке, своей копией SESSION_SECRET, и стоило копии разойтись с
 * серверной, как письма уходили с нерабочими ссылками — молча, потому что
 * проверить их можно только нажав. Теперь подписывает тот, кто потом и
 * проверяет.
 *
 * Ключ нужен сильный: здесь выдаются токены, привязывающие чужой телеграм
 * к учётке, и слабым ключом пингера такое доверять нельзя.
 */
type Ask = {
  users?: { id?: string | null; email?: string }[];
  /** Сколько дней живёт ссылка привязки. Письмо открывают не в тот же день. */
  botLinkDays?: number;
  withBotLink?: boolean;
};

/** Разом просят на всю рассылку, но не на весь интернет. */
const MAX_USERS = 300;

export async function POST(req: Request): Promise<Response> {
  if (cronRights(req) !== 'force') {
    console.error('mail-links: вызов без сильного ключа —', describeAuth(req));
    return Response.json({ error: 'нужен сильный ключ' }, { status: 401 });
  }

  let ask: Ask;
  try {
    ask = (await req.json()) as Ask;
  } catch {
    return Response.json({ error: 'ожидается json' }, { status: 400 });
  }

  const users = (ask.users ?? []).filter((u) => u.email);
  if (users.length === 0) return Response.json({ error: 'некому' }, { status: 400 });
  if (users.length > MAX_USERS) {
    return Response.json({ error: `за раз не больше ${MAX_USERS}` }, { status: 400 });
  }

  const days = Number(ask.botLinkDays ?? 14);
  const links: Record<string, { unsubToken: string; botUrl: string | null }> = {};

  for (const u of users) {
    const email = String(u.email).toLowerCase();
    // Ссылку привязки заводим только тем, кто в базе есть: у названного
    // руками адреса учётки может не быть вовсе.
    const botUrl = ask.withBotLink && u.id ? await linkUrl(u.id, days * 24 * 60) : null;
    links[email] = { unsubToken: unsubToken(email), botUrl };
  }

  return Response.json({ origin: new URL(req.url).origin, links });
}
