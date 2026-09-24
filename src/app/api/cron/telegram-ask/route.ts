import { cronRights, describeAuth } from '@/lib/cron-auth';
import {
  askTargets, askView, claimSend, isConfigured, recordSent, releaseSend, send,
} from '@/lib/telegram';

export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

/**
 * Вечерний вопрос: «кто придёт завтра». Зовётся расписанием Vercel, см.
 * vercel.json.
 *
 * Адрес открыт всему интернету, поэтому сверяем секрет. Vercel сам
 * подставляет его в заголовок, если в проекте задан CRON_SECRET; нет
 * секрета — не работаем вовсе, иначе рассылку сможет запустить кто
 * угодно и сколько угодно раз.
 */
/** Телеграм принимает около тридцати сообщений в секунду. Не частим. */
function pause(): Promise<void> {
  return new Promise((r) => setTimeout(r, 120));
}

export async function GET(req: Request): Promise<Response> {
  if (cronRights(req) === 'none') {
    const got = describeAuth(req);
    console.error('cron: вызов без ключа —', got);
    return Response.json({ error: 'ключ не подошёл', got }, { status: 401 });
  }
  if (!isConfigured()) return Response.json({ skipped: 'бот не настроен' });

  const targets = await askTargets();
  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const t of targets) {
    const campaign = `ask:${t.session_id}`;
    // Место в журнале занимаем до отправки: крон может сработать дважды,
    // и родитель получит один и тот же вопрос два раза.
    if (!(await claimSend(campaign, t.chat_id))) { skipped++; continue; }

    const view = await askView(t.user_id, t.session_id);
    // Занятие отменили или семья ему больше не подходит — спрашивать не о чем.
    if (!view) { skipped++; continue; }

    const ok = await send(Number(t.chat_id), view.text, view.keyboard);
    if (ok) {
      await recordSent(campaign, t.chat_id, view.text);
      sent++;
    } else {
      failed++;
      // Не ушло — снимаем отметку, чтобы следующий запуск попробовал ещё
      // раз. Заблокировавший бота сюда больше не попадёт: у него снята
      // привязка, и в списке его уже нет.
      await releaseSend(campaign, t.chat_id);
    }
    await pause();
  }

  console.log(`cron: вопросов ${targets.length}, отправлено ${sent}, пропущено ${skipped}, не ушло ${failed}`);
  return Response.json({ targets: targets.length, sent, skipped, failed });
}
