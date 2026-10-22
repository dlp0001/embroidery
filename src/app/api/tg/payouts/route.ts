import { payoutPlan } from '@/lib/payouts';
import { miniappReady, miniappUser } from '@/lib/tg-miniapp';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * График выплат Isracard для мини-приложения. Только админам: это
 * движение денег студии по счёту, а не чьи-то занятия.
 *
 * Отдаём то же, что показывает «Выплаты» в журнале, но короче: день,
 * сколько придёт на счёт и за какие продажи. Комиссию и валовую сумму
 * тоже, иначе «пришло меньше, чем продали» каждый раз пугает.
 */
export async function GET(req: Request): Promise<Response> {
  if (!miniappReady()) return Response.json({ error: 'бот не настроен' }, { status: 503 });

  const user = await miniappUser(req);
  if (!user?.admin) return Response.json({ error: 'нет доступа' }, { status: 403 });

  const plan = await payoutPlan();
  const short = (p: (typeof plan.upcoming)[number]) => ({
    day: p.day,
    due: p.due,
    gross: Math.round(p.gross),
    fee: Math.round(p.fee),
    net: Math.round(p.net),
    credits: p.credits.map((c) => ({
      who: c.who,
      course: c.source === 'course',
      saleDay: c.saleDay,
      amount: Math.round(c.amount),
      part: c.part,
      parts: c.parts,
      guessed: c.guessed,
    })),
  });

  return Response.json({
    name: user.name,
    upcoming: plan.upcoming.map(short),
    past: plan.past.map(short),
    unasked: plan.unasked,
  });
}
