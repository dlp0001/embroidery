import Link from 'next/link';
import { requireUser } from '@/lib/session';
import { familyParticipants, visitHistory, type VisitRow } from '@/lib/studio';
import { dayMonth, money } from '@/lib/format';

export const dynamic = 'force-dynamic';

const MONTHS = ['январь','февраль','март','апрель','май','июнь','июль','август','сентябрь','октябрь','ноябрь','декабрь'];

/** Чем закрыто занятие и когда. Одна строка под именем. */
function paidWith(r: VisitRow): { text: string; cls: string } {
  if (r.status === 'absent') return { text: 'Пропуск', cls: 'tag-ok' };
  if (r.status === 'sick') return { text: 'Болезнь', cls: 'tag-ok' };
  if (r.status === 'trial') return { text: 'Пробное', cls: 'tag-ok' };

  if (r.money === 'pass') {
    return { text: r.pass_event ? 'Из пакета' : 'Из абонемента', cls: 'tag-ok' };
  }
  if (r.money === 'paid') return { text: 'Оплачено', cls: 'tag-ok' };
  if (r.money === 'due') return { text: 'Не оплачено', cls: 'tag-due' };
  return { text: 'Без оплаты', cls: 'tag-ok' };
}

/** Чем именно заплатили: к «Оплачено» нужна подробность, иначе это не ответ. */
function how(r: VisitRow): string | null {
  if (r.money !== 'paid') return null;
  if (r.provider !== 'cash') return 'картой';
  if (r.pay_method === 'bit') return 'битом';
  if (r.pay_method === 'paybox') return 'пейбоксом';
  return 'наличными или переводом';
}

export default async function HistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ p?: string; due?: string }>;
}) {
  const user = await requireUser();
  const { p: person, due } = await searchParams;
  const onlyDue = due === '1';

  const [family, rows] = await Promise.all([
    familyParticipants(user.id),
    visitHistory(user.id, { participantId: person, onlyDue }),
  ]);

  const byMonth = new Map<string, VisitRow[]>();
  for (const r of rows) {
    const key = r.held_on.slice(0, 7);
    byMonth.set(key, [...(byMonth.get(key) ?? []), r]);
  }

  /** Ссылка фильтра: меняет одно, остальное оставляет как было. */
  const href = (next: { p?: string | null; due?: boolean }) => {
    const q = new URLSearchParams();
    const who = next.p === undefined ? person : next.p ?? undefined;
    const d = next.due === undefined ? onlyDue : next.due;
    if (who) q.set('p', who);
    if (d) q.set('due', '1');
    const s = q.toString();
    return s ? `/account/history?${s}` : '/account/history';
  };

  const chip = (on: boolean): string => (on ? 'chip-on' : 'chip');

  return (
    <>
      <div className="top">
        <div className="kicker">Re.Create.Art · Студия</div>
        <h1 className="h1">История</h1>
        <p className="sub">Занятия, на которых были, и что с оплатой</p>
      </div>

      <div className="body">
        {/* Фильтры: у кого две-три строки в истории, тот их не заметит,
            а у семьи, которая ходит второй год, без них не найти нужное. */}
        {family.length > 1 && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
            <Link className={chip(!person)} href={href({ p: null })}>Все</Link>
            {family.map((f) => (
              <Link key={f.id} className={chip(person === f.id)} href={href({ p: f.id })}>
                {f.name}
              </Link>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 18 }}>
          <Link className={chip(!onlyDue)} href={href({ due: false })}>Все занятия</Link>
          <Link className={chip(onlyDue)} href={href({ due: true })}>Только неоплаченные</Link>
        </div>

        {rows.length === 0 && (
          <p className="hint" style={{ marginTop: 20 }}>
            {onlyDue ? 'Неоплаченных занятий нет.' : 'Занятий пока не было.'}
          </p>
        )}

        {[...byMonth.entries()].map(([month, list]) => (
          <section key={month}>
            <div className="lbl">{MONTHS[Number(month.slice(5, 7)) - 1]} {month.slice(0, 4)}</div>
            {list.map((r) => {
              const label = paidWith(r);
              const way = how(r);
              const came = r.status === 'present' || r.status === 'trial';
              return (
                <div className="card" key={`${r.session_id}-${r.participant_id}`}>
                  <div className="row" style={{ alignItems: 'flex-start' }}>
                    <div>
                      <div className="when">{dayMonth(r.held_on)} · {r.group_title}</div>
                      <div className="what">{r.who}</div>
                      {/* Сумму пишем только там, где она есть: за пропуск
                          и болезнь денег не берут. */}
                      {came && r.amount && (
                        <div className="sub" style={{ marginTop: 4 }}>
                          {money(Number(r.amount), r.currency ?? 'ILS')}
                          {way ? `, ${way}` : ''}
                          {r.money === 'paid' && r.paid_at
                            ? ` · ${dayMonth(r.paid_at.slice(0, 10))}`
                            : ''}
                        </div>
                      )}
                    </div>
                    <div className={`tag ${label.cls}`}>{label.text}</div>
                  </div>
                </div>
              );
            })}
          </section>
        ))}
      </div>
    </>
  );
}
