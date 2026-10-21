'use client';

import { useEffect, useState } from 'react';
import type { Pulse } from '@/lib/tg-stats';

type Data = Pulse & { name: string | null };

/**
 * Экран статистики внутри телеграма. Страница открыта как мини-приложение,
 * поэтому входа у неё нет: телеграм сам кладёт в window подписанную строку
 * initData, её и предъявляем серверу. Открытая в обычном браузере, страница
 * честно говорит, что её надо открывать из бота.
 */

declare global {
  interface Window {
    Telegram?: { WebApp?: {
      initData: string;
      ready: () => void;
      expand: () => void;
      colorScheme?: string;
    } };
  }
}

const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

function dayMonth(iso: string): string {
  const [, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]}`;
}

function money(n: number, currency: string): string {
  const sign = currency === 'ILS' ? '₪' : currency;
  return `${n.toLocaleString('ru-RU').replace(/ /g, ' ')} ${sign}`;
}

function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

function salesLine(s: Pulse['course']['month']): string {
  if (!s.count) return 'покупок нет';
  const sums = s.sums.map((x) => money(x.sum, x.currency)).join(' · ');
  const bought = `${s.count} ${plural(s.count, 'покупка', 'покупки', 'покупок')}`;
  return sums ? `${bought}, ${sums}` : bought;
}

export default function Stats() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const tg = window.Telegram?.WebApp;
    if (!tg?.initData) {
      setError('Эта страница открывается из бота студии, кнопкой «Статистика».');
      return;
    }
    tg.ready();
    tg.expand();
    fetch('/api/tg/stats', { headers: { authorization: `tma ${tg.initData}` } })
      .then(async (r) => {
        if (r.status === 403) throw new Error('Статистику видят только Варя и админы студии.');
        if (!r.ok) throw new Error('Не получилось забрать числа. Попробуйте позже.');
        return r.json();
      })
      .then(setData)
      .catch((e: Error) => setError(e.message));
  }, []);

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
        <div className="card">
          <div className="row">
            <div className="what">Получено</div>
            <div className="what">{money(m.taken, m.currency)}</div>
          </div>
          <div className="sub">
            {m.payments}&nbsp;{plural(m.payments, 'платёж', 'платежа', 'платежей')}
          </div>
        </div>
        <div className="card">
          <div className="row">
            <div className="what">Реализация</div>
            <div className="what">{money(m.lesson + m.camp, m.currency)}</div>
          </div>
          <div className="sub">
            занятия — {money(m.lesson, m.currency)}
            {m.camp > 0 ? ` · лагерь — ${money(m.camp, m.currency)}` : ''}
          </div>
        </div>
        {m.debtPeople > 0 && (
          <div className="card">
            <div className="row">
              <div className="what">Долги</div>
              <div className="what" style={{ color: 'var(--rose-dark)' }}>
                {money(m.debtSum, m.currency)}
              </div>
            </div>
            <div className="sub">
              у {m.debtPeople}&nbsp;{plural(m.debtPeople, 'человека', 'человек', 'человек')}
            </div>
          </div>
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
