import Link from 'next/link';
import { requireParent } from '@/lib/session';
import { familyParticipants, visitHistory, type VisitRow } from '@/lib/studio';
import { dayMonth, money, shortDate } from '@/lib/format';

export const dynamic = 'force-dynamic';

const MONTHS = ['январь','февраль','март','апрель','май','июнь','июль','август','сентябрь','октябрь','ноябрь','декабрь'];

/**
 * Значок оплаты: зелёный — деньги за занятие закрыты, красный — нет.
 * У пропуска и болезни значка нет: там и платить нечего.
 */
function Mark({ r }: { r: VisitRow }) {
  const came = r.status === 'present' || r.status === 'trial';
  if (!came || r.money === 'none') return <span className="visit-mark" />;
  const ok = r.money !== 'due';
  return (
    <span className={`visit-mark ${ok ? 'mark-ok' : 'mark-due'}`}
          title={ok ? 'Оплачено' : 'Не оплачено'} role="img"
          aria-label={ok ? 'Оплачено' : 'Не оплачено'}>
      <svg viewBox="0 0 20 20">
        <circle cx="10" cy="10" r="8" />
        {ok ? <path d="M6.2 10.4 9 13.2 13.9 7.4" /> : <path d="M10 6.2v5M10 13.4v.9" />}
      </svg>
    </span>
  );
}

/**
 * Что писать про оплату словами. Значок отвечает «да» или «нет», а здесь
 * подробности: чем и когда заплатили, из какого пакета списано.
 *
 * Способ помечает Варя, когда подтверждает получение денег. Если пометки
 * нет — платёж старый, и точнее «наличными или переводом» не скажешь.
 */
function about(r: VisitRow): string {
  if (r.status === 'absent') return 'пропуск';
  if (r.status === 'sick') return 'болезнь';
  if (r.status === 'trial') return 'пробное';
  if (r.money === 'pass') return r.pass_event ? 'из пакета' : 'из абонемента';
  if (r.money === 'none') return 'без оплаты';
  if (r.money === 'due') return 'не оплачено';

  const way = r.provider !== 'cash' ? 'картой'
    : r.pay_method === 'bit' ? 'битом'
    : r.pay_method === 'paybox' ? 'пейбоксом'
    : r.pay_method === 'cash' ? 'наличными'
    : r.pay_method === 'transfer' ? 'переводом'
    : 'наличными или переводом';
  return r.paid_at ? `${way} · ${shortDate(r.paid_at.slice(0, 10))}` : way;
}

export default async function HistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ p?: string; due?: string }>;
}) {
  const user = await requireParent();
  const { p: person, due } = await searchParams;
  const onlyDue = due === '1';

  const [family, rows] = await Promise.all([
    familyParticipants(user.id),
    visitHistory(user.id, { participantId: person, onlyDue }),
  ]);

  // Месяц → день и группа → кто в этот день был. Дата пишется один раз
  // на всех: у семьи с тремя детьми она иначе повторяется трижды подряд.
  const byMonth = new Map<string, Map<string, VisitRow[]>>();
  for (const r of rows) {
    const month = r.held_on.slice(0, 7);
    const day = `${r.held_on}\u0000${r.group_title}`;
    const days = byMonth.get(month) ?? new Map<string, VisitRow[]>();
    days.set(day, [...(days.get(day) ?? []), r]);
    byMonth.set(month, days);
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

  const chip = (on: boolean): string => `${on ? 'chip-on' : 'chip'} chip-sm`;

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
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
            <Link className={chip(!person)} href={href({ p: null })}>Все</Link>
            {family.map((f) => (
              <Link key={f.id} className={chip(person === f.id)} href={href({ p: f.id })}>
                {f.name}
              </Link>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
          <Link className={chip(!onlyDue)} href={href({ due: false })}>Все занятия</Link>
          <Link className={chip(onlyDue)} href={href({ due: true })}>Только неоплаченные</Link>
        </div>

        {rows.length === 0 && (
          <p className="hint" style={{ marginTop: 20 }}>
            {onlyDue ? 'Неоплаченных занятий нет.' : 'Занятий пока не было.'}
          </p>
        )}

        {[...byMonth.entries()].map(([month, days]) => (
          <section key={month}>
            <div className="lbl" style={{ margin: '18px 0 2px' }}>
              {MONTHS[Number(month.slice(5, 7)) - 1]} {month.slice(0, 4)}
            </div>
            {[...days.entries()].map(([key, list]) => (
              <div key={key}>
                <div className="when visit-day">
                  {dayMonth(key.split('\u0000')[0])} · {key.split('\u0000')[1]}
                </div>
                {list.map((r) => {
                  const came = r.status === 'present' || r.status === 'trial';
                  return (
                    <div className="visit" key={`${r.session_id}-${r.participant_id}`}>
                      <div className="visit-who">{r.who}</div>
                      {/* Сумма только там, где она есть: за пропуск и болезнь
                          денег не берут. Пустая колонка всё равно нужна,
                          иначе съедет всё, что правее. */}
                      <div className="visit-sum">
                        {came && r.amount ? money(Number(r.amount), r.currency ?? 'ILS') : ''}
                      </div>
                      <Mark r={r} />
                      <div className="visit-how">{about(r)}</div>
                    </div>
                  );
                })}
              </div>
            ))}
          </section>
        ))}
      </div>
    </>
  );
}
