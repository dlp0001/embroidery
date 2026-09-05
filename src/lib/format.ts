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
  return `${Number.isInteger(n) ? n : n.toFixed(2)} ${sign}`;
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

/** Русские склонения: plural(2, 'занятие', 'занятия', 'занятий'). */
export function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}
