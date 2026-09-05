import Link from 'next/link';
import { notFound } from 'next/navigation';
import { isAdmin, requireTeacher } from '@/lib/session';
import { lessonPrice, sessionHead, sessionRoster } from '@/lib/studio';
import { dayMonth, hhmm, money } from '@/lib/format';
import Journal from '@/components/Journal';

export const dynamic = 'force-dynamic';

export default async function SessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireTeacher();
  const head = await sessionHead(id);
  if (!head) notFound();
  if (!isAdmin(user) && head.teacher_id !== user.id) notFound();

  const [roster, price] = await Promise.all([sessionRoster(id), lessonPrice()]);

  return (
    <>
      <div className="top">
        <div style={{ fontSize: 12, color: 'var(--warm-gray)', marginBottom: 10 }}>
          <Link href="/admin/studio" style={{ color: 'var(--warm-gray)' }}>Студия</Link> · {head.group_title}
        </div>
        <div className="kicker">{dayMonth(head.held_on)} · {hhmm(head.starts_at)}</div>
        <h1 className="h1">{head.group_title}</h1>
        <p className="sub">Отметьте тех, кто пришёл. Сверху те, кого ждём.</p>
      </div>

      <div className="body">
        {roster.length === 0 ? (
          <p className="hint" style={{ marginTop: 20 }}>В группе пока никого нет.</p>
        ) : (
          <>
            <Journal
              sessionId={id}
              roster={roster}
              price={money(price.amount, price.currency)}
              saved={head.status === 'done'}
            />
            <p className="hint" style={{ marginTop: 18 }}>
              Нажмите на имя, чтобы снять отметку. Нажмите на строчку про деньги,
              чтобы отметить оплату наличными.
            </p>
          </>
        )}
      </div>
    </>
  );
}
