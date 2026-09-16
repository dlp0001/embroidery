import { STUDIO_TZ } from './time';

const MONTHS = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
const WEEKDAYS = ['воскресенье','понедельник','вторник','среда','четверг','пятница','суббота'];

/** "2026-03-11" → "11 марта". Дату разбираем вручную, чтобы не поймать сдвиг часового пояса. */
export function dayMonth(iso: string): string {
  const [, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]}`;
}

export function weekdayDayMonth(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const name = WEEKDAYS[wd];
  return `${name.charAt(0).toUpperCase()}${name.slice(1)}, ${d} ${MONTHS[m - 1]}`;
}

export function hhmm(time: string): string {
  return time.slice(0, 5);
}

export function money(amount: string | number, currency = 'ILS'): string {
  const n = Math.round(Number(amount) * 100) / 100;
  const sign = currency === 'ILS' ? '₪' : currency;
  // Неразрывный пробел: сумма и знак валюты не должны расходиться по строкам.
  return `${Number.isInteger(n) ? n : n.toFixed(2)}\u00a0${sign}`;
}

/** Сколько дней осталось до даты. Отрицательное — дата уже прошла. */
export function daysUntil(iso: string, from: string): number {
  const [ay, am, ad] = iso.split('-').map(Number);
  const [by, bm, bd] = from.split('-').map(Number);
  const a = Date.UTC(ay, am - 1, ad);
  const b = Date.UTC(by, bm - 1, bd);
  return Math.round((a - b) / 86400000);
}

/** Сегодняшняя дата по времени студии, а не по времени сервера. */
export function todayISO(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: STUDIO_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/**
 * Ник в телеграме пишут как придётся: с «собакой», без неё, ссылкой
 * t.me или целым https. Приводим к одному виду — голому нику, «собаку»
 * дорисовываем при показе. Пусто — ника нет, это законно: поле необязательное.
 * ok = false — написано что-то, но на ник не похоже, и молча стирать это нельзя.
 */
export function telegramNick(raw: string): { ok: boolean; nick: string | null } {
  const bare = raw
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/^(?:www\.)?(?:t\.me|telegram\.me|telegram\.dog)\//i, '')
    .replace(/^@/, '')
    .replace(/\/+$/, '');
  if (!bare) return { ok: true, nick: null };
  // Правила телеграма: латиница, цифры и подчёркивание, первый знак — буква,
  // всего от пяти до тридцати двух.
  if (!/^[a-zA-Z][a-zA-Z0-9_]{4,31}$/.test(bare)) return { ok: false, nick: null };
  return { ok: true, nick: bare };
}

/** Русские склонения: plural(2, 'занятие', 'занятия', 'занятий'). */
export function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}
