import { one } from '@/lib/db';
import { doctype, isConfigured as icountReady } from '@/lib/icount';
import { isConfigured as payplusReady } from '@/lib/payplus';

export const runtime = 'nodejs';
export const maxDuration = 10;
export const dynamic = 'force-dynamic';

/**
 * Что настроено на этом деплое. Только «да» и «нет»: ни ключей, ни
 * строк подключения, ни имён. Нужен, чтобы не гадать после правки
 * переменных в Vercel.
 */
export async function GET() {
  // Сколько времени уходит на базу: без этого числа непонятно, тормозит
  // ли запрос или сама сборка ответа.
  const started = Date.now();
  let dbMs = 0;
  let db = false;
  let lastMigration: string | null = null;
  let migrations = 0;
  try {
    db = Boolean(await one('select 1 as ok'));
    // Видно, докатили ли схему: код без своей миграции падает молча.
    const row = await one<{ n: string; last: string | null }>(
      `select count(*)::text as n, max(name) as last from _migrations`,
    );
    migrations = Number(row?.n ?? 0);
    lastMigration = row?.last ?? null;
  } catch {
    db = false;
  }
  dbMs = Date.now() - started;

  return Response.json(
    {
      db,
      dbMs,
      // Какой коммит сейчас на этом деплое. Иначе после пуша непонятно,
      // доехала сборка или отвечает предыдущая.
      commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
      migrations,
      lastMigration,
      resend: Boolean(process.env.RESEND_API_KEY),
      telegram: Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_BOT_NAME),
      telegramHook: Boolean(process.env.TELEGRAM_WEBHOOK_SECRET),
      // Без него вечерний вопрос не рассылается: роут расписания
      // отвечает 401 всем, включая сам Vercel.
      cron: Boolean(process.env.CRON_SECRET),
      // Второй ключ: им отправляют немедленно, мимо окон. Нет — значит
      // принудительной отправки нет вовсе, и это не поломка, а выбор.
      cronForce: Boolean(process.env.CRON_FORCE_SECRET),
      payplus: payplusReady(),
      payplusEnv: process.env.PAYPLUS_ENV === 'prod' ? 'prod' : 'test',
      icount: icountReady(),
      icountDoctype: doctype(),
      // Без номера счёта перевод в квитанцию не оформить.
      icountBank: Boolean(process.env.ICOUNT_BANK_ACCOUNT),
      sheets: Boolean(process.env.GOOGLE_SERVICE_ACCOUNT && process.env.GOOGLE_SHEET_ID),
      bunny: Boolean(process.env.BUNNY_TOKEN_KEY),
    },
    { headers: { 'cache-control': 'no-store' } },
  );
}
