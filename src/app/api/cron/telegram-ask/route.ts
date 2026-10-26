import { cronRights, describeAuth } from '@/lib/cron-auth';
import {
  askTargets, askView, claimSend, isConfigured, packOutTargets, packOutView,
  passEndsTargets, passEndsView, passOutTargets, passOutView,
  recordSent, releaseSend, send,
} from '@/lib/telegram';
import { lessonPrice } from '@/lib/studio';
import { todayISO } from '@/lib/format';
import { siteOrigin } from '@/lib/site';

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

  // Вопрос один на день: в нём оба занятия, если их в этот день два.
  // Ключ рассылки поэтому дневной, а не по занятию.
  for (const t of targets) {
    const campaign = `ask:${t.held_on}`;
    // Место в журнале занимаем до отправки: крон может сработать дважды,
    // и родитель получит один и тот же вопрос два раза.
    if (!(await claimSend(campaign, t.chat_id))) { skipped++; continue; }

    const view = await askView(t.user_id, t.session_id);
    // Занятие отменили или семья ему больше не подходит — спрашивать не о чем.
    if (!view) { skipped++; continue; }

    const ok = await send(Number(t.chat_id), view.text, view.keyboard, view.html);
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

  // Тем же заходом — про кончившиеся пакеты смены: сообщение вечернее,
  // как и вопрос, и второй рассылке ради него заводиться незачем.
  const origin = await siteOrigin();
  let packs = 0;
  for (const t of await packOutTargets()) {
    // Ключ помнит и размер пакета: докупили дни, снова истратили —
    // и про это скажем ещё раз, а про то же самое дважды не скажем.
    const campaign = `pack-out:${t.pass_id}:${t.lessons_total}`;
    if (!(await claimSend(campaign, t.chat_id))) continue;

    const view = packOutView(t, origin);
    if (await send(Number(t.chat_id), view.text)) {
      await recordSent(campaign, t.chat_id, view.text);
      packs++;
    } else {
      await releaseSend(campaign, t.chat_id);
    }
    await pause();
  }

  // Абонементы — тем же заходом. Два разных повода: занятия кончились
  // раньше срока и срок кончается раньше занятий. Оба раза человек
  // теряет деньги молча, и оба раза об этом некому сказать.
  const today = todayISO();
  let passes = 0;
  const price = await lessonPrice();
  for (const t of await passOutTargets()) {
    // Ключ с размером абонемента: купили новый на столько же занятий и
    // снова истратили — скажем ещё раз, а про тот же дважды не скажем.
    const campaign = `pass-out:${t.pass_id}:${t.lessons_total}`;
    if (!(await claimSend(campaign, t.chat_id))) continue;

    const view = passOutView(t, price, origin);
    if (await send(Number(t.chat_id), view.text)) {
      await recordSent(campaign, t.chat_id, view.text);
      passes++;
    } else {
      await releaseSend(campaign, t.chat_id);
    }
    await pause();
  }

  let ending = 0;
  for (const t of await passEndsTargets()) {
    // Дата в ключе: срок продлили — предупредим про новый.
    const campaign = `pass-ends:${t.pass_id}:${t.valid_to}`;
    if (!(await claimSend(campaign, t.chat_id))) continue;

    const view = passEndsView(t, today, origin);
    if (await send(Number(t.chat_id), view.text)) {
      await recordSent(campaign, t.chat_id, view.text);
      ending++;
    } else {
      await releaseSend(campaign, t.chat_id);
    }
    await pause();
  }

  console.log(`cron: вопросов ${targets.length}, отправлено ${sent}, пропущено ${skipped},`
    + ` не ушло ${failed}, про кончившиеся пакеты ${packs},`
    + ` про кончившиеся абонементы ${passes}, про сгорающий срок ${ending}`);
  return Response.json({
    targets: targets.length, sent, skipped, failed, packs, passes, ending,
  });
}
