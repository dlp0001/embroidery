'use client';

import type { Pulse } from '@/lib/tg-stats';
import { dayMonth, Fold, money, plural, Row, useMiniapp } from '../parts';

type Data = Pulse & { name: string | null };

/**
 * Экран статистики внутри телеграма. Числа забирает у /api/tg/stats,
 * предъявляя подпись телеграма: своего входа у страницы нет.
 */
function salesLine(s: Pulse['course']['month']): string {
  if (!s.count) return 'покупок нет';
  const sums = s.sums.map((x) => money(x.sum, x.currency)).join(' · ');
  const bought = `${s.count}\u00a0${plural(s.count, 'покупка', 'покупки', 'покупок')}`;
  return sums ? `${bought}, ${sums}` : bought;
}

export default function Stats() {
  const { data, error } = useMiniapp<Data>('/api/tg/stats');

  if (error) return <p className="hint" style={{ padding: 20 }}>{error}</p>;
  if (!data) return <p className="hint" style={{ padding: 20 }}>Считаем…</p>;

  const { money: m, course, bot, week } = data;
  const first = (data.name ?? '').trim().split(/\s+/)[0];

  return (
    <div className="app">
      <div className="top">
        <div className="kicker">Re.Create.Art · Студия</div>
        <h1 className="h1">Как дела</h1>
        <p className="sub">
          {first ? `${first}, ` : ''}сегодня {dayMonth(data.today)}
        </p>
      </div>

      <div className="body">
        <div className="lbl">Сегодня</div>
        {data.sessions.length === 0 ? (
          <p className="hint" style={{ marginBottom: 18 }}>Занятий нет.</p>
        ) : data.sessions.map((s) => (
          <div className="card" key={`${s.title}${s.at}`}>
            <div className="row">
              <div>
                <div className="when">{s.at}{s.moved ? ' · перенесено' : ''}</div>
                <div className="what">{s.title}</div>
                <div className="money">
                  записались {s.booked}, ждём {s.people}
                  {s.marked > 0 ? ` · отмечено ${s.marked}` : ''}
                </div>
              </div>
            </div>
          </div>
        ))}

        <div className="lbl">Деньги с {dayMonth(m.since)}</div>

        <Fold
          title="Получено"
          total={money(m.taken, m.currency)}
          note={`${m.payments} ${plural(m.payments, 'платёж', 'платежа', 'платежей')}`}
        >
          {m.takenBy.map((r) => (
            <Row
              key={r.label}
              left={`${r.label} · ${r.count}`}
              right={money(r.sum, m.currency)}
            />
          ))}
        </Fold>

        <Fold
          title="Реализация"
          total={money(m.lesson + m.camp, m.currency)}
          note={`занятия — ${money(m.lesson, m.currency)}${
            m.camp > 0 ? ` · лагерь — ${money(m.camp, m.currency)}` : ''}`}
        >
          {m.done.map((r) => (
            <Row
              key={r.label}
              left={`${r.label} · ${r.count}`}
              right={money(r.sum, m.currency)}
            />
          ))}
          <p className="hint" style={{ marginTop: 10 }}>
            Занятие с абонемента стоит свою долю от его цены, а не сотню.
          </p>
        </Fold>

        {m.debtPeople > 0 && (
          <Fold
            title="Долги"
            total={money(m.debtSum, m.currency)}
            accent
            note={`у ${m.debtPeople} ${plural(m.debtPeople, 'человека', 'человек', 'человек')}`}
          >
            {m.debts.map((d) => (
              <Row
                key={d.who}
                left={`${d.who} · ${d.lessons} ${
                  plural(d.lessons, 'занятие', 'занятия', 'занятий')} с ${dayMonth(d.since)}`}
                right={money(d.sum, m.currency)}
              />
            ))}
          </Fold>
        )}

        <div className="lbl">Курс по вышивке</div>
        <div className="card">
          <div className="sub" style={{ marginTop: 0 }}>
            с {dayMonth(m.since)} — {salesLine(course.month)}
          </div>
          <div className="sub">всего — {salesLine(course.all)}</div>
        </div>

        <div className="lbl">Неделя</div>
        <div className="card">
          <div className="sub" style={{ marginTop: 0 }}>
            занятий прошло — {week.lessons}, приходили {week.visits}&nbsp;
            {plural(week.visits, 'раз', 'раза', 'раз')}
          </div>
          <div className="sub">
            записей — {week.booked}, из них через бота {week.viaBot}
          </div>
        </div>

        <div className="lbl">Бот</div>
        <div className="card">
          <div className="sub" style={{ marginTop: 0 }}>
            подключили {bot.inBot} из {bot.people}
          </div>
          <div className="sub">
            за месяц спросили {bot.asked}&nbsp;
            {plural(bot.asked, 'раз', 'раза', 'раз')}, ответили кнопкой {bot.answered}
          </div>
        </div>

        <p className="hint" style={{ marginTop: 18 }}>
          Реализация — то, что прошло: деньги за это могли прийти раньше или
          ещё не прийти. Долги считаются по неоплаченным занятиям.
        </p>
      </div>
    </div>
  );
}
