import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Защита форм, которые шлют письма, от ботов. Боты подставляют чужие
 * адреса в формы входа на сотнях сайтов, чтобы завалить жертву письмами,
 * и наш сайт для них — один из таких. Письма уходят с нашего домена
 * незнакомым людям, а жалобы на спам бьют по доставке всех наших писем.
 *
 * Два признака бота, без капчи:
 *  - скрытое поле, которое человек не видит, а бот заполняет;
 *  - подписанная отметка времени, когда страницу отдали. Её нет —
 *    форму отправили в обход страницы; слишком свежая — так быстро
 *    человек почту не вводит.
 */

/** Имя скрытого поля. Похоже на настоящее, чтобы бот его заполнил. */
export const TRAP_FIELD = 'website';
export const STAMP_FIELD = 'stamp';

/** Быстрее этого человек форму не отправит даже с автозаполнением. */
const MIN_MS = 1500;
/** Страница старше суток — пусть обновят: отметку не используют вечно. */
const MAX_MS = 24 * 60 * 60 * 1000;

function sign(ts: string): string {
  return createHmac('sha256', process.env.SESSION_SECRET ?? '')
    .update(`form:${ts}`)
    .digest('base64url')
    .slice(0, 22);
}

/** Отметка для страницы с формой. Звать при каждой отдаче страницы. */
export function formStamp(): string {
  const ts = String(Date.now());
  return `${ts}.${sign(ts)}`;
}

export type Verdict = 'ok' | 'bot' | 'fast' | 'stale';

/**
 * bot — молча делать вид, что всё отправлено: боту незачем знать, что его
 * поймали. fast и stale — сказать человеку: он нажмёт ещё раз.
 */
export function checkForm(form: FormData): Verdict {
  if (String(form.get(TRAP_FIELD) ?? '').trim()) return 'bot';
  const raw = String(form.get(STAMP_FIELD) ?? '');
  const [ts, sig] = raw.split('.');
  if (!ts || !sig) return 'bot';
  const expected = Buffer.from(sign(ts));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return 'bot';
  const age = Date.now() - Number(ts);
  if (!Number.isFinite(age) || age < 0) return 'bot';
  if (age < MIN_MS) return 'fast';
  if (age > MAX_MS) return 'stale';
  return 'ok';
}
