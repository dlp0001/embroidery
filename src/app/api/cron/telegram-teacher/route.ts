import { cronRights, describeAuth } from '@/lib/cron-auth';
import { sendDue, type Force } from '@/lib/tg-due';

export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

/**
 * Сообщения преподавателю: утренняя сводка и напоминание за час до занятия.
 *
 * Роут тонкий, вся работа в lib/tg-due. Зовут его снаружи по расписанию, а
 * та же функция срабатывает при открытии журнала: за первый день расписание
 * GitHub дало два запуска вместо двадцати семи, и одному триггеру верить
 * нельзя.
 *
 * Ключей два. Обычный умеет только спросить «что пора»: его не страшно
 * отдать внешнему сервису, потому что окна по времени и отметки в tg_log
 * превращают любой лишний вызов в пустой. Немедленная отправка требует
 * второго ключа и остаётся у нас.
 */
export async function GET(req: Request): Promise<Response> {
  const rights = cronRights(req);
  if (rights === 'none') {
    const got = describeAuth(req);
    console.error('cron-teacher: вызов без ключа —', got);
    return Response.json({ error: 'ключ не подошёл', got }, { status: 401 });
  }

  const asked = new URL(req.url).searchParams.get('force');
  if (asked && rights !== 'force') {
    console.error('cron-teacher: force чужим ключом');
    return Response.json({ error: 'force требует своего ключа' }, { status: 403 });
  }
  const force: Force = asked === 'day' || asked === 'next' ? asked : null;

  return Response.json({ force, ...(await sendDue(force)) });
}
