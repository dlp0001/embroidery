import { one } from '@/lib/db';
import { askTargets, askView, isConfigured, send } from '@/lib/telegram';

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
function allowed(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get('authorization') === `Bearer ${secret}`;
}

/** Телеграм принимает около тридцати сообщений в секунду. Не частим. */
function pause(): Promise<void> {
  return new Promise((r) => setTimeout(r, 120));
}

export async function GET(req: Request): Promise<Response> {
  if (!allowed(req)) {
    console.error('cron: вызов без секрета');
    return Response.json({ error: 'forbidden' }, { status: 401 });
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
    const claimed = await one(
      `insert into tg_log (campaign, chat_id) values ($1, $2)
       on conflict (campaign, chat_id) do nothing
       returning chat_id`,
      [campaign, t.chat_id],
    );
    if (!claimed) { skipped++; continue; }

    const view = await askView(t.user_id, t.session_id);
    // Занятие отменили или семья ему больше не подходит — спрашивать не о чем.
    if (!view) { skipped++; continue; }

    const ok = await send(Number(t.chat_id), view.text, view.keyboard);
    if (ok) {
      sent++;
    } else {
      failed++;
      // Не ушло — снимаем отметку, чтобы следующий запуск попробовал ещё
      // раз. Заблокировавший бота сюда больше не попадёт: у него снята
      // привязка, и в списке его уже нет.
      await one('delete from tg_log where campaign = $1 and chat_id = $2 returning chat_id',
        [campaign, t.chat_id]);
    }
    await pause();
  }

  console.log(`cron: вопросов ${targets.length}, отправлено ${sent}, пропущено ${skipped}, не ушло ${failed}`);
  return Response.json({ targets: targets.length, sent, skipped, failed });
}
