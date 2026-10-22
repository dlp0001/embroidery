'use client';

import { useEffect, useState } from 'react';

/**
 * Общие детали экранов мини-приложения: как забрать подпись у телеграма,
 * как показать деньги и как раскрыть карточку. Экранов два, и расходиться
 * им в мелочах нельзя — у них один хозяин и одна минута внимания.
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

export function dayMonth(iso: string): string {
  const [, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]}`;
}

export function money(n: number, currency = 'ILS'): string {
  const sign = currency === 'ILS' ? '₪' : currency;
  const digits = Math.round(n).toLocaleString('ru-RU').replace(/ /g, ' ');
  return `${digits} ${sign}`;
}

export function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

/**
 * Данные экрана: подпись у телеграма, запрос, ошибка словами. Открытая
 * в обычном браузере страница честно говорит, что её надо открывать из
 * бота: подписи там нет и взяться ей неоткуда.
 */
export function useMiniapp<T>(path: string): { data: T | null; error: string | null } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const tg = window.Telegram?.WebApp;
    if (!tg?.initData) {
      setError('Эта страница открывается из бота студии, командой в меню.');
      return;
    }
    tg.ready();
    tg.expand();
    fetch(path, { headers: { authorization: `tma ${tg.initData}` } })
      .then(async (r) => {
        if (r.status === 403) throw new Error('Этот экран видят только Варя и админы студии.');
        if (!r.ok) throw new Error('Не получилось забрать числа. Попробуйте позже.');
        return r.json();
      })
      .then(setData)
      .catch((e: Error) => setError(e.message));
  }, [path]);

  return { data, error };
}

/**
 * Карточка с итогом, которая раскрывается по нажатию. Закрытая она
 * такая же, как была: цифра справа и подпись под ней. Раскрытая
 * показывает строки, из которых цифра сложилась.
 *
 * Открыта или закрыта — живёт в состоянии экрана, а не в адресе: экран
 * один, и возвращаться к нему «назад» телеграм не даёт.
 */
export function Fold({
  title, total, note, accent = false, children,
}: {
  title: string;
  total: string;
  note: string;
  accent?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="card">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        style={{
          display: 'block', width: '100%', padding: 0, border: 0,
          background: 'none', textAlign: 'left', cursor: 'pointer',
        }}
      >
        <div className="row">
          <div className="what">
            {title}
            <span style={{
              display: 'inline-block', marginLeft: 8, fontSize: 11,
              color: 'var(--warm-gray)', transform: open ? 'rotate(90deg)' : 'none',
              transition: 'transform .15s',
            }}>▸</span>
          </div>
          <div className="what" style={accent ? { color: 'var(--rose-dark)' } : undefined}>
            {total}
          </div>
        </div>
        <div className="sub">{note}</div>
      </button>
      {open && (
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--line-soft)' }}>
          {children}
        </div>
      )}
    </div>
  );
}

/** Строка внутри раскрытой карточки. */
export function Row({ left, right, dim = false }: { left: string; right: string; dim?: boolean }) {
  return (
    <div className="row" style={{ alignItems: 'baseline', marginBottom: 6 }}>
      <div style={{ fontSize: 13, color: dim ? 'var(--warm-gray)' : 'var(--charcoal)' }}>{left}</div>
      <div style={{ fontSize: 13, whiteSpace: 'nowrap' }}>{right}</div>
    </div>
  );
}
