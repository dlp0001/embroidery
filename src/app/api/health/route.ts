import { one } from '@/lib/db';
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

  return Response.json(
    {
      db,
      migrations,
      lastMigration,
      resend: Boolean(process.env.RESEND_API_KEY),
      payplus: payplusReady(),
      payplusEnv: process.env.PAYPLUS_ENV === 'prod' ? 'prod' : 'test',
      sheets: Boolean(process.env.GOOGLE_SERVICE_ACCOUNT && process.env.GOOGLE_SHEET_ID),
      bunny: Boolean(process.env.BUNNY_TOKEN_KEY),
    },
    { headers: { 'cache-control': 'no-store' } },
  );
}
