import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { takenBetween } from './billing';
import { sales as courseSales, type Sales } from './course-admin';
import { one, query, tx } from './db';
import { shopName } from './expenses';
import { familyOwners } from './family';
import {
  cents, dayMonth, daysUntil, eventClosed, hhmm, money, nowHM, plural, plusDays, todayISO,
  weekdayDayMonth,
} from './format';
import { payoutPlan, type Payout } from './payouts';
import { periodStats } from './stats';
import {
  PASS_WARN_DAYS, debtors, eventSlotsForUser, markDeclined, passBalances, sessionIsPast,
  setBooking, slotsForUser, teacherSessions, unclosedBefore, unpaidCharges,
  type GroupKind, type SlotRow,
} from './studio';

const API = 'https://api.telegram.org';

/** Столько живёт ссылка привязки. Как код входа, только короче. */
const LINK_TTL_MIN = 15;

export function isConfigured(): boolean {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_BOT_NAME);
}

/**
 * Сверка секрета вебхука. Адрес открыт всему интернету, и без этой
 * проверки апдейты боту шлёт кто угодно — телеграм для того и передаёт
 * заголовок при setWebhook.
 */
export function secretOk(given: string | null): boolean {
  const want = process.env.TELEGRAM_WEBHOOK_SECRET ?? '';
  if (!want || !given) return false;
  const a = Buffer.from(want);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

// ── Разговор с телеграмом ─────────────────────────────────

type ApiResult<T> =
  | { ok: true; result: T }
  | { ok: false; code: number | null; why: string };

async function call<T>(method: string, payload: unknown): Promise<ApiResult<T>> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return { ok: false, code: null, why: 'TELEGRAM_BOT_TOKEN не задан' };
  try {
    const res = await fetch(`${API}/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      // Телеграм иногда молчит минутами. Рассылка подождёт, вебхук — нет.
      signal: AbortSignal.timeout(10_000),
    });
    const data = (await res.json()) as {
      ok?: boolean; result?: T; error_code?: number; description?: string;
    };
    if (!data.ok) {
      return { ok: false, code: data.error_code ?? res.status, why: data.description ?? 'без объяснения' };
    }
    return { ok: true, result: data.result as T };
  } catch (err) {
    return { ok: false, code: null, why: err instanceof Error ? err.message : 'запрос не прошёл' };
  }
}

/**
 * Сообщение в чат. Ответ 403 означает, что бота заблокировали: это не
 * ошибка, а сигнал — адрес больше не наш, и долбиться в него каждый
 * вечер незачем. Снимаем привязку молча, человек вернёт её кнопкой в
 * профиле, если захочет.
 */
/**
 * Кнопка под сообщением. Обычная шлёт боту callback_data, а web_app
 * открывает мини-приложение: это единственный способ попасть в него,
 * кроме кнопки у поля ввода.
 */
export type Button =
  | { text: string; callback_data: string; web_app?: never }
  | { text: string; web_app: { url: string }; callback_data?: never };
export type Keyboard = Button[][];

/**
 * Жирный шрифт телеграм понимает только с разметкой, а разметка ломается
 * о чужой текст: имя с амперсандом или пересланное сообщение с «<» уедут
 * в никуда. Поэтому включаем её поштучно — там, где текст собрали мы
 * сами, — и всё подставляемое прогоняем через esc.
 */
export function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export async function send(
  chatId: number, text: string, keyboard?: Keyboard, html = false,
): Promise<boolean> {
  return (await sendAndGetId(chatId, text, keyboard, html)) !== null;
}

/** То же, но отдаёт номер сообщения: на него потом отвечают. */
export async function sendAndGetId(
  chatId: number, text: string, keyboard?: Keyboard, html = false,
): Promise<number | null> {
  const res = await call<{ message_id: number }>('sendMessage', {
    chat_id: chatId,
    text,
    ...(html ? { parse_mode: 'HTML' } : {}),
    link_preview_options: { is_disabled: true },
    ...(keyboard?.length ? { reply_markup: { inline_keyboard: keyboard } } : {}),
  });
  if (res.ok) return res.result?.message_id ?? null;
  if (res.code === 403) {
    await forgetChat(chatId);
    console.log('telegram: бот заблокирован, привязка снята');
    return null;
  }
  console.error('telegram: сообщение не ушло', res.code, res.why);
  return null;
}

/**
 * Перерисовка того же сообщения после нажатия. Телеграм отвечает ошибкой,
 * если текст и кнопки не изменились ни на знак: это не беда, а обычное
 * дело при двойном нажатии, и молчать в ответ правильно.
 */
export async function editMessage(
  chatId: number, messageId: number, text: string, keyboard?: Keyboard, html = false,
): Promise<void> {
  const res = await call('editMessageText', {
    chat_id: chatId,
    message_id: messageId,
    text,
    ...(html ? { parse_mode: 'HTML' } : {}),
    link_preview_options: { is_disabled: true },
    ...(keyboard?.length ? { reply_markup: { inline_keyboard: keyboard } } : {}),
  });
  if (!res.ok && !res.why.includes('message is not modified')) {
    console.error('telegram: сообщение не перерисовано', res.code, res.why);
  }
}

/**
 * Ответ на нажатие. Обязателен: пока он не придёт, кнопка у родителя
 * крутится. Поэтому зовём его всегда, в том числе когда отказали.
 */
export async function answerCallback(id: string, text?: string): Promise<void> {
  const res = await call('answerCallbackQuery', { callback_query_id: id, ...(text ? { text } : {}) });
  // Молчать тут нельзя: отказ виден родителю как навсегда зависшая кнопка,
  // а в логах не остаётся ничего.
  if (!res.ok) console.error('telegram: нажатие без ответа', res.code, res.why);
}

// ── Привязка ──────────────────────────────────────────────

function hashToken(raw: string): string {
  const pepper = process.env.SESSION_SECRET ?? '';
  return createHash('sha256').update(`tg:${raw}:${pepper}`).digest('hex');
}

/**
 * Ссылка привязки. Одноразовая, по умолчанию на четверть часа, и это
 * единственный
 * способ связать чат с учёткой. Ни по почте, ни по нику, ни по номеру
 * телефона: иначе к чужой семье с детьми и долгами привяжется
 * посторонний, назвавший чужой адрес.
 */
export async function linkUrl(userId: string, ttlMin = LINK_TTL_MIN): Promise<string | null> {
  const bot = process.env.TELEGRAM_BOT_NAME;
  if (!bot) return null;
  // base64url: в start телеграм пускает латиницу, цифры, дефис и
  // подчёркивание, и не больше 64 знаков. Двадцать четыре байта дают 32.
  const raw = randomBytes(24).toString('base64url');
  await query(
    `insert into tg_links (user_id, token_hash, expires_at)
     values ($1, $2, now() + ($3 || ' minutes')::interval)`,
    [userId, hashToken(raw), String(ttlMin)],
  );
  return `https://t.me/${bot.replace(/^@/, '')}?start=${raw}`;
}

export type Bound = { ok: true; userId: string; name: string | null } | { ok: false };

export async function bindChat(raw: string, chatId: number): Promise<Bound> {
  const link = await one<{ id: string; user_id: string }>(
    `select id, user_id from tg_links
      where token_hash = $1 and used_at is null and expires_at > now()`,
    [hashToken(raw)],
  );
  if (!link) return { ok: false };

  const name = await tx(async (c) => {
    // Этот же чат мог быть привязан к другой учётке: ссылка пришла из
    // профиля, значит хозяин чата теперь тот, кто её оттуда открыл.
    await c.query('update users set tg_chat_id = null where tg_chat_id = $1', [chatId]);
    await c.query('update users set tg_chat_id = $1 where id = $2', [chatId, link.user_id]);
    await c.query('update tg_links set used_at = now() where id = $1', [link.id]);
    const { rows } = await c.query<{ name: string | null }>(
      'select name from users where id = $1', [link.user_id]);
    return rows[0]?.name ?? null;
  });
  return { ok: true, userId: link.user_id, name };
}

export async function forgetChat(chatId: number): Promise<void> {
  await query('update users set tg_chat_id = null where tg_chat_id = $1', [chatId]);
}

export async function unlinkUser(userId: string): Promise<void> {
  await query('update users set tg_chat_id = null where id = $1', [userId]);
}

/** Кто написал боту. null — чат не привязан ни к кому. */
export async function chatUser(chatId: number): Promise<{ id: string; name: string | null } | null> {
  return one<{ id: string; name: string | null }>(
    'select id, name from users where tg_chat_id = $1', [chatId]);
}

export async function chatOfUser(userId: string): Promise<number | null> {
  const row = await one<{ tg_chat_id: string | null }>(
    'select tg_chat_id::text from users where id = $1', [userId]);
  return row?.tg_chat_id ? Number(row.tg_chat_id) : null;
}

// ── Кнопки ────────────────────────────────────────────────

/**
 * Два uuid в callback_data не помещаются: телеграм даёт 64 байта, а
 * текстом они занимают 72. Кладём их сырыми байтами в base64url — по 22
 * знака, и вместе с пометкой действия выходит 48.
 */
export function packId(id: string): string {
  return Buffer.from(id.replace(/-/g, ''), 'hex').toString('base64url');
}

export function unpackId(s: string): string | null {
  const b = Buffer.from(s, 'base64url');
  if (b.length !== 16) return null;
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/**
 * Откуда нажали: из списка (неделя, смена) или из вечернего вопроса.
 * Это решает, какое сообщение перерисовать в ответ, — подменить вопрос
 * недельной простынёй значит стереть родителю то, что он читал.
 */
export type TapFrom = 'list' | 'ask';

export type Tap = {
  sessionId: string; participantId: string; book: boolean; from: TapFrom;
};

/** Разбор нажатия. Всё, что пришло не от нашей кнопки, — мусор. */
export function readTap(data: string): Tap | null {
  const m = /^([ba])([01]):([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{22})$/.exec(data);
  if (!m) return null;
  const sessionId = unpackId(m[3]);
  const participantId = unpackId(m[4]);
  if (!sessionId || !participantId) return null;
  return {
    sessionId, participantId,
    book: m[2] === '1',
    from: m[1] === 'a' ? 'ask' : 'list',
  };
}

function tapData(row: SlotRow, book: boolean, from: TapFrom): string {
  return `${from === 'ask' ? 'a' : 'b'}${book ? '1' : '0'}`
    + `:${packId(row.session_id)}.${packId(row.participant_id)}`;
}

/**
 * Участник из семьи этого взрослого? Проверка та же, что в кабинете:
 * в callback_data приезжает что угодно, и верить ей нельзя.
 */
/** Способы оплаты, как их понимает iCount. Буква едет в кнопке. */
export const PAY_LETTER = { c: 'cash', t: 'transfer', b: 'bit', p: 'paybox' } as const;
export type PayLetter = keyof typeof PAY_LETTER;
export type PayMethod = (typeof PAY_LETTER)[PayLetter];

export type MoneyTap =
  | { kind: 'method'; paymentId: string; letter: PayLetter }
  | { kind: 'confirm'; paymentId: string; letter: PayLetter; receipt: boolean }
  | { kind: 'decline'; paymentId: string }
  | { kind: 'back'; paymentId: string };

/**
 * Нажатия на карточке заявки об оплате. Отдельно от записи на занятия:
 * тут решаются деньги, и проверять права надо иначе — это дело админа, а
 * не родителя.
 */
export function readMoneyTap(data: string): MoneyTap | null {
  const m = /^p(m([ctbp])|c([ctbp])([01])|x|b):([A-Za-z0-9_-]{22})$/.exec(data);
  if (!m) return null;
  const paymentId = unpackId(m[5]);
  if (!paymentId) return null;
  if (m[2]) return { kind: 'method', paymentId, letter: m[2] as PayLetter };
  if (m[3]) {
    return { kind: 'confirm', paymentId, letter: m[3] as PayLetter, receipt: m[4] === '1' };
  }
  return m[1] === 'x'
    ? { kind: 'decline', paymentId }
    : { kind: 'back', paymentId };
}

/** Деньги подтверждает админ. Преподавателю без админства сюда нельзя. */
export async function isStudioAdmin(userId: string): Promise<boolean> {
  return Boolean(await one(
    `select 1 from user_roles where user_id = $1 and role in ('admin', 'superadmin')`,
    [userId]));
}

// ── Переписка через бота ──────────────────────────────────

/** Кому идут сообщения родителей. Пока только тем, кто отвечает за всё. */
async function relayChats(): Promise<number[]> {
  const rows = await query<{ chat: string }>(
    `select distinct u.tg_chat_id::text as chat
       from users u join user_roles r on r.user_id = u.id
      where r.role = 'superadmin' and u.tg_chat_id is not null`,
  );
  return rows.map((r) => Number(r.chat));
}

/**
 * Родитель написал боту. Передаём сообщение в студию и запоминаем, чьё
 * оно: ответят на эту же карточку — ответом в телеграме, и он должен
 * вернуться тому, кто спрашивал.
 *
 * Пересылаем не forward, а своим текстом: forward показал бы имя и ник
 * родителя из его профиля, а нам нужно имя, под которым он в студии.
 */
export async function relayFromParent(
  user: { id: string; name: string | null }, text: string,
): Promise<boolean> {
  const chats = await relayChats();
  if (chats.length === 0) return false;

  const who = user.name ?? 'Без имени';
  const card = [`Сообщение от ${who}:`, '', text.slice(0, 1500), '', 'Ответьте на это сообщение — передам.'].join('\n');

  let sent = 0;
  for (const chat of chats) {
    const id = await sendAndGetId(chat, card);
    if (id === null) continue;
    await query(
      `insert into tg_relay (chat_id, message_id, user_id) values ($1, $2, $3)
       on conflict (chat_id, message_id) do update set user_id = excluded.user_id`,
      [chat, id, user.id],
    );
    sent++;
  }
  return sent > 0;
}

/**
 * Ответ студии на пересланное сообщение. Возвращает имя родителя, если
 * ответ ушёл: по нему подтверждаем отправку тому, кто отвечал.
 */
export async function relayAnswer(
  chatId: number, replyTo: number, text: string,
): Promise<string | null> {
  const row = await one<{ user_id: string; chat: string | null; name: string | null }>(
    `select r.user_id, u.tg_chat_id::text as chat, u.name
       from tg_relay r join users u on u.id = r.user_id
      where r.chat_id = $1 and r.message_id = $2`,
    [chatId, replyTo],
  );
  if (!row?.chat) return null;
  const ok = await send(Number(row.chat), [
    'Ответ из студии:', '', text.slice(0, 3000),
  ].join('\n'));
  return ok ? (row.name ?? 'родителю') : null;
}

/** Старые связки не нужны: ответить на прошлогоднее сообщение никто не придёт. */
export async function forgetOldRelays(days = 60): Promise<void> {
  await query(`delete from tg_relay where created_at < now() - ($1 || ' days')::interval`,
    [String(days)]);
}

export async function ownsParticipant(userId: string, participantId: string): Promise<boolean> {
  const ok = await one(
    `select 1 from participants p
      where p.id = $1
        and (p.user_id = $2 or p.child_id in (select child_id from guardians where user_id = $2))`,
    [participantId, userId],
  );
  return Boolean(ok);
}

// ── Экраны ──────────────────────────────────────────

/** Чем занятие отличается от обычного детского. Ничем — значит без пометки. */
function tag(row: SlotRow): string | null {
  if (row.kind === 'camp') return 'лагерь';
  if (row.kind === 'event') return 'мастер-класс';
  return row.audience === 'adults' ? 'взрослое' : null;
}

/** Имя без фамилии: на кнопке она не нужна, а места занимает много. */
function shortName(who: string): string {
  return who.split(' ')[0];
}

/** "2026-10-02" → "Пт, 2 октября": в списке занятий день недели сокращаем. */
function shortWeekDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const wd = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'][new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${wd}, ${dayMonth(iso)}`;
}

/** "2026-09-25" → "пт 25": подпись на кнопке, где длинной даты не поместится. */
function shortDay(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const wd = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'][new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${wd} ${d}`;
}

export type View = {
  text: string;
  keyboard: Keyboard;
  /** Текст собран с разметкой: слать и перерисовывать его надо как HTML. */
  html?: boolean;
  /** Показывать нечего. Преподавателю такую неделю не присылаем. */
  empty?: boolean;
};

/** Смена знает свою группу: по ней после нажатия находим, что перерисовать. */
export type GroupView = View & { groupId: string };

/**
 * Кнопки по две в ряд: у семьи с тремя детьми их на неделю выходит
 * дюжина, и столбиком они превращают сообщение в простыню. День подписан
 * на каждой, поэтому ряд может начинаться с середины занятия.
 */
function rows2(buttons: Button[]): Keyboard {
  const keyboard: Keyboard = [];
  for (let i = 0; i < buttons.length; i += 2) keyboard.push(buttons.slice(i, i + 2));
  return keyboard;
}

/**
 * Дни и люди под ними. Общая разметка недели и смены: разойдись тут
 * подпись мест или пометка «придёт», и родитель в одном сообщении
 * увидел бы одно, а в соседнем другое.
 *
 * На кнопке, в отличие от кабинета, стоит не действие, а состояние:
 * галочка значит «записан». Кнопка тут единственное, что можно нажать,
 * и читается она вместе со строчкой над собой, а не вместо неё.
 */
/** Кнопка на каждого, кого ещё можно записать или уже можно отменить. */
function slotButtons(rows: SlotRow[], today: string): Button[] {
  const shown = rows.filter((r) => {
    // День прошёл — обещать приход поздно. Мест нет — записаться некуда,
    // но свою запись снять можно всегда.
    if (r.held_on < today) return false;
    // День смены закрывается в обед: состав к этому часу уже у студии,
    // и кнопка, которая ничего не сделает, хуже её отсутствия.
    if (r.kind !== 'lesson' && eventClosed(r.held_on)) return false;
    const free = r.capacity === null ? null : Math.max(r.capacity - r.taken, 0);
    return r.booked || free !== 0;
  });

  // Время на кнопке — только там, где в этот день у человека не одно
  // занятие. Иначе «чт 29 · Линда» стоит дважды, и выбрать нельзя; а
  // ставить время всем — растить кнопки в дни, где и так всё ясно.
  const perDay = new Map<string, number>();
  for (const r of shown) perDay.set(r.held_on, (perDay.get(r.held_on) ?? 0) + 1);

  return shown.map((r) => ({
    text: `${r.booked ? '✓ ' : ''}${(perDay.get(r.held_on) ?? 0) > 1
      ? `${shortDay(r.held_on)}, ${hhmm(r.starts_at)}`
      : shortDay(r.held_on)} · ${shortName(r.who)}`,
    callback_data: tapData(r, !r.booked, 'list'),
  }));
}

/**
 * Кнопки блоками по людям: сначала все дни одного ребёнка, потом другого.
 * Вперемешку по дням родитель отмечает один день и ищет глазами, где же
 * второй ребёнок, — а отмечают обычно всё сразу и на одного.
 */
function personBlocks(rows: SlotRow[], today: string): Keyboard {
  const byWho = new Map<string, SlotRow[]>();
  const sorted = [...rows].sort(
    (a, b) => a.who.localeCompare(b.who) || a.held_on.localeCompare(b.held_on),
  );
  for (const r of sorted) {
    byWho.set(r.participant_id, [...(byWho.get(r.participant_id) ?? []), r]);
  }
  // Ряды считаем внутри блока: иначе последняя кнопка одного ребёнка
  // встаёт в пару к первой кнопке другого, и блоки слипаются.
  const keyboard: Keyboard = [];
  for (const list of byWho.values()) keyboard.push(...rows2(slotButtons(list, today)));
  return keyboard;
}

/**
 * Занятия недели списком: день со временем одной строкой, места — второй.
 *
 * Имён в тексте нет нарочно: они стоят на кнопках под сообщением, и
 * повторять их ещё и здесь значит растить сообщение вдвое там, где
 * ничего нового не сказано.
 */
function weekLines(rows: SlotRow[]): string[] {
  const bySession = new Map<string, SlotRow[]>();
  for (const r of rows) bySession.set(r.session_id, [...(bySession.get(r.session_id) ?? []), r]);

  const lines: string[] = [];
  for (const people of bySession.values()) {
    const head = people[0];
    const when = [shortWeekDate(head.held_on), hhmm(head.starts_at)];
    if (head.moved) when.push('перенесено');
    const what = tag(head);
    if (what) when.push(what);

    // Места в той же строке: на отдельную они просили место, а говорят
    // одно слово. Своим «мест нет» не пишем: место уже занято вами —
    // правило то же, что в кабинете, в SlotList.
    const free = head.capacity === null
      ? null
      : Math.max(head.capacity - head.taken, 0);
    const ours = people.some((p) => p.booked);
    if (free !== null && !(free === 0 && ours)) {
      when.push(free === 0
        ? 'мест нет'
        : `${free} ${plural(free, 'место', 'места', 'мест')}`);
    }
    lines.push(when.join(', '));
  }
  return lines;
}

/**
 * Ближайшая неделя семьи: сообщение и кнопки под ним. Одна функция на
 * оба случая — и на первую отправку, и на перерисовку после нажатия,
 * иначе они разъедутся.
 */
export async function weekView(userId: string, origin: string): Promise<View> {
  const today = todayISO();
  const rows = (await slotsForUser(userId, today, plusDays(today, 7)))
    .filter((r) => r.kind === 'lesson');
  if (rows.length === 0) {
    return {
      text: `На ближайшую неделю занятий нет.\n\nРасписание целиком: ${origin}/account/calendar`,
      keyboard: [],
      empty: true,
    };
  }
  return {
    text: [
      '<b>Ближайшие занятия:</b>',
      '',
      ...weekLines(rows),
      '',
      'Галочка — записан. Нажмите, чтобы записать или отменить.',
      `Оплата, история и остальное: ${origin}/account`,
    ].join('\n'),
    keyboard: personBlocks(rows, today),
    html: true,
  };
}

/**
 * Лагерь и мастер-классы — отдельными сообщениями, по одному на смену.
 *
 * Смена идёт подряд много дней и решается один раз, а неделя живёт своим
 * чередом: в общем сообщении эти два списка мешали бы друг другу, и
 * десять дней лагеря заслонили бы четыре занятия. Когда смена кончится,
 * сообщение перестанет приходить само: дней в будущем не останется.
 */
export async function eventViews(userId: string, origin: string): Promise<GroupView[]> {
  const today = todayISO();
  const byGroup = new Map<string, SlotRow[]>();
  for (const r of await eventSlotsForUser(userId)) {
    byGroup.set(r.group_id, [...(byGroup.get(r.group_id) ?? []), r]);
  }

  const out: GroupView[] = [];
  for (const slots of byGroup.values()) {
    const head = slots[0];
    const days = [...new Map(slots.map((s) => [s.held_on, s])).values()]
      .sort((a, b) => a.held_on.localeCompare(b.held_on));
    // Начало пишем один раз в шапке: у смены все дни начинаются в одно
    // время. День, который перенесли, подписываем отдельно в списке.
    const usual = head.starts_at;
    const what = head.kind === 'camp' ? 'лагерь' : 'мастер-класс';
    // «Лагерь на Суккот · лагерь» — пометка, которая уже в названии.
    const title = head.group_title.toLowerCase().includes(what)
      ? head.group_title
      : `${head.group_title} · ${what}`;

    // Шапка короткая: название, срок и время. Цена и пакеты — в «Оплате»,
    // куда ведёт последняя строка; здесь это только мешало увидеть дни.
    const top = [
      `<b>${esc(title)}</b>`,
      `${dayMonth(days[0].held_on)} — ${dayMonth(days[days.length - 1].held_on)} · ${hhmm(usual)}`,
    ];

    // Дни списком, а не карточками: какой день и кто на него идёт, видно
    // по кнопкам, и повторять это ещё и текстом значит получить полотно
    // на полсотни строк. Текстом остаётся то, чего на кнопке не написать,
    // — сколько мест свободно.
    const left = days
      .filter((d) => d.held_on >= today && !eventClosed(d.held_on))
      .map((d) => {
        const free = d.capacity === null ? null : Math.max(d.capacity - d.taken, 0);
        const when = d.starts_at === usual ? '' : ` (${hhmm(d.starts_at)})`;
        if (free === null) return `${shortDay(d.held_on)}${when}`;
        return `${shortDay(d.held_on)}${when} — ${free === 0 ? 'нет мест' : free}`;
      });
    if (left.length > 0) top.push(`Свободно: ${left.join(', ')}`);

    out.push({
      groupId: head.group_id,
      text: [...top, '', 'Галочка — записан. Нажмите, чтобы отметить дни.',
             `Пакет и оплата: ${origin}/account/pay`].join('\n'),
      // У смены кнопки идут блоками по человеку, а не вперемешку по дням:
      // родитель отмечает все дни одному ребёнку подряд, и в списке из
      // тридцати кнопок это единственный способ не сбиться.
      keyboard: personBlocks(slots, today),
      html: true,
    });
  }
  return out;
}

// ── Журнал отправленного ──────────────────────────────────

/**
 * Рассылки идут по журналу: отметку занимают до отправки, чтобы повторный
 * запуск не прислал то же дважды. Обе рассылки пользуются одними
 * функциями — иначе правила «что считать отправленным» разъедутся.
 */
export async function claimSend(campaign: string, chatId: string): Promise<boolean> {
  return Boolean(await one(
    `insert into tg_log (campaign, chat_id) values ($1, $2)
     on conflict (campaign, chat_id) do nothing returning chat_id`,
    [campaign, chatId]));
}

/** Не ушло — снимаем отметку, чтобы следующий запуск попробовал снова. */
export async function releaseSend(campaign: string, chatId: string): Promise<void> {
  await one('delete from tg_log where campaign = $1 and chat_id = $2 returning chat_id',
    [campaign, chatId]);
}

/**
 * Что именно ушло. Складываем текст целиком: пожелание выбирается
 * случайно, а прочитать отправленное у Telegram нельзя, и без этого на
 * вопрос «что получил человек» ответить нечем.
 */
export async function recordSent(campaign: string, chatId: string, text: string): Promise<void> {
  await query('update tg_log set text = $3 where campaign = $1 and chat_id = $2',
    [campaign, chatId, text]);
}

/** Сколько минут назад это отправляли. null — не отправляли вовсе. */
export async function sentAgoMin(campaign: string, chatId: string): Promise<number | null> {
  const row = await one<{ ago: string }>(
    `select (extract(epoch from (now() - sent_at)) / 60)::int::text as ago
       from tg_log where campaign = $1 and chat_id = $2`,
    [campaign, chatId]);
  return row ? Number(row.ago) : null;
}

// ── Экран преподавателя ───────────────────────────────────

/**
 * Преподавателю бот отвечает не тем же, что родителю.
 *
 * Только роль `teacher`, без админов: админ — это Дима, у него в студии
 * свой ребёнок, и подменять ему родительскую неделю журналом незачем. Кто
 * и преподаёт, и водит детей, получит оба сообщения.
 */
export async function isTeacher(userId: string): Promise<boolean> {
  return Boolean(await one(
    `select 1 from user_roles where user_id = $1 and role = 'teacher'`,
    [userId]));
}

type RosterRow = {
  who: string; booking: string; declined: boolean; preferred: boolean;
  /** Занятий этой группы за восемь недель и сколько из них человек был. */
  was: number;
  came: number;
  /** И сколько раз был на других занятиях этого же дня недели. */
  came_other: number;
};

/**
 * Кого ждать на занятии. Состав тот же, что в журнале у Вари: все, кто
 * подходит занятию по типу. Различаем три вещи, потому что они означают
 * разное: записался, обычно ходит, но молчит, и прямо сказал «не придём».
 *
 * Для второго считаем ещё и то, как оно выходило на деле: день в профиле
 * ставят щедро, и в одном списке оказывались и те, кто ходит каждую
 * неделю, и те, кто не появлялся с лета.
 */
async function roster(sessionId: string): Promise<RosterRow[]> {
  return query<RosterRow>(
    `with ses as (
       select s.id, s.group_id, s.held_on, g.audience, g.kind,
              extract(isodow from s.held_on)::int as dow
         from studio_sessions s join studio_groups g on g.id = s.group_id
        where s.id = $1
     )
     select coalesce(ch.name, u.name, 'Без имени') as who,
            coalesce(b.status, '') as booking,
            (b.declined_at is not null) as declined,
            (select count(*)::int from studio_sessions s3 cross join ses
              where s3.group_id = ses.group_id and s3.status <> 'cancelled'
                and s3.held_on between ses.held_on - 56 and ses.held_on - 1) as was,
            (select count(*)::int from attendance a3
               join studio_sessions s3 on s3.id = a3.session_id
               cross join ses
              where a3.participant_id = p.id
                and s3.group_id = ses.group_id and s3.status <> 'cancelled'
                and a3.status in ('present', 'trial')
                and s3.held_on between ses.held_on - 56 and ses.held_on - 1) as came,
            (select count(*)::int from attendance a4
               join studio_sessions s4 on s4.id = a4.session_id
               join studio_groups g4 on g4.id = s4.group_id
               cross join ses
              where a4.participant_id = p.id
                and g4.kind = 'lesson' and g4.weekday = ses.dow and g4.id <> ses.group_id
                and s4.status <> 'cancelled' and a4.status in ('present', 'trial')
                and s4.held_on between ses.held_on - 56 and ses.held_on - 1) as came_other,
            exists (select 1 from preferred_days pd cross join ses
                     where pd.participant_id = p.id and pd.weekday = ses.dow
                       and ses.kind = 'lesson') as preferred
       from participants p
       cross join ses
       left join children ch on ch.id = p.child_id
       left join users u on u.id = p.user_id
       left join bookings b on b.session_id = ses.id and b.participant_id = p.id
      where ch.archived_at is null
        and ((ses.audience = 'adults' and p.user_id is not null
              and (u.attends or (ses.kind <> 'lesson' and b.status = 'booked')))
          or (ses.audience = 'kids' and p.child_id is not null))
      order by who`,
    [sessionId]);
}

/**
 * Чем закончить сообщение. Каждый раз другое: одна и та же строчка каждое
 * утро через неделю читается как подпись в подвале и перестаёт значить
 * что-либо.
 *
 * Регистр тот же, что в письмах студии: коротко, точкой, без красот. И
 * без длинных тире — так просила Варя, см. scripts/letters/camp-sukkot.mjs.
 * Восклицательный знак остаётся только в приветствии.
 */
const WISHES = [
  'Хорошего дня и лёгкого занятия.',
  'Пусть день будет спокойный.',
  'Спокойного дня и красивых работ.',
  'Пусть всё пройдёт легко.',
  'Хорошего занятия.',
  'Пусть занятие будет в радость.',
  'Доброго дня.',
  'Пусть день порадует.',
  'Приятного дня и хорошего занятия.',
  'Пусть всё получится.',
];

function wish(): string {
  return WISHES[Math.floor(Math.random() * WISHES.length)];
}

function greeting(name: string): string {
  const { hour } = nowHM();
  const part = hour < 12 ? 'Доброе утро' : hour < 17 ? 'Добрый день' : 'Добрый вечер';
  return `${part}, ${name}!`;
}

/**
 * Как звать преподавателя. Преподаватель пока один и просил звать себя
 * так, поэтому имя стоит в коде, а не в настройках: появится второй
 * педагог — станет полем, а до тех часов это лишняя таблица.
 */
const PET: Record<string, string> = { Варя: 'Варюша' };

/** Первое слово имени: «Варя Перлина» → «Варюша». */
function firstName(name: string | null): string {
  const first = (name ?? '').trim().split(/\s+/)[0] || 'Варя';
  return PET[first] ?? first;
}

/**
 * Одно занятие для преподавателя. Списки пишем только непустые: «сказали,
 * что не придут: никого» — строка, которая ничего не сообщает, а место
 * занимает.
 */
async function sessionLines(
  sessionId: string, title: string, at: string, moved: boolean,
): Promise<string[]> {
  const rows = await roster(sessionId);
  const coming = rows.filter((r) => r.booking === 'booked').map((r) => r.who);
  const refused = rows.filter((r) => r.declined).map((r) => r.who);
  // Отмеченный день — это «возможно, придём», и держать всех таких одной
  // строкой бесполезно: в ней вперемешку те, кто ходит каждую неделю, и
  // те, кто не появлялся два месяца. Варе важны первые.
  // Отмеченный день говорит «в этот день мы в студии», а не «на этом
  // занятии». Когда занятий в дне два, ждём там, куда человек ходит;
  // кто не ходил никуда — остаётся в обоих, пока не появится.
  const marked = rows.filter(
    (r) => r.preferred && r.booking === '' && (r.came > 0 || r.came_other === 0));
  // Сюда же те, по кому судить не по чему: занятий этой группы за два
  // месяца не было вовсе. Молчать про них нельзя — это новая группа или
  // вернувшаяся после перерыва, и ждать их надо как раньше.
  const usual = marked.filter((r) => r.came * 2 >= r.was).map((r) => r.who);
  const seldom = marked
    .filter((r) => r.was > 0 && r.came > 0 && r.came * 2 < r.was)
    .map((r) => `${r.who} (${r.came} из ${r.was})`);
  const gone = marked.filter((r) => r.was > 0 && r.came === 0).map((r) => r.who);

  // Перенос ставим сразу за временем: на эту строку и смотрят, решая,
  // когда быть в студии.
  const lines = [`${hhmm(at)}${moved ? ' · перенесено' : ''} · ${title}`];
  lines.push(coming.length > 0
    ? `Записались (${coming.length}): ${coming.join(', ')}`
    : 'Записанных нет.');
  if (usual.length > 0) lines.push(`Обычно ходят, но не отметились: ${usual.join(', ')}`);
  if (seldom.length > 0) lines.push(`Ходят редко: ${seldom.join(', ')}`);
  if (gone.length > 0) lines.push(`Ни разу за два месяца: ${gone.join(', ')}`);
  // Только те, кто прямо ответил боту «не придёт». Снятая на сайте запись
  // сюда не попадает: это отсутствие записи, а не обещание не прийти, и
  // мешать их в одну строку значит врать Варе про чужие слова.
  if (refused.length > 0) lines.push(`Не придут: ${refused.join(', ')}`);
  return lines;
}

export type Teacher = { id: string; name: string | null; chat_id: string };

/** Преподаватели, до которых бот может дотянуться. */
export async function teachersInBot(): Promise<Teacher[]> {
  return query<Teacher>(
    `select u.id, u.name, u.tg_chat_id::text as chat_id
       from users u join user_roles r on r.user_id = u.id
      where r.role = 'teacher' and u.tg_chat_id is not null`);
}

/**
 * Кому идёт копия утренней сводки. Суперадмин, а не всякий админ: админ —
 * это Варя, ей сводка и так адресована, а копия нужна тому, кто смотрит за
 * студией со стороны. Роль преподавателя для этого не годится: она
 * подменила бы ему родительскую неделю журналом и прислала бы ещё и
 * напоминания за час.
 */
export async function digestWatchers(): Promise<Teacher[]> {
  return query<Teacher>(
    `select u.id, u.name, u.tg_chat_id::text as chat_id
       from users u join user_roles r on r.user_id = u.id
      where r.role = 'superadmin' and u.tg_chat_id is not null`);
}

/** Сегодняшние занятия преподавателя — обёртка, чтобы роут не лез в studio. */
export async function teacherToday(teacherId: string): Promise<
  { session_id: string; group_title: string; starts_at: string; moved: boolean }[]
> {
  return (await teacherSessions(teacherId)).map((s) => ({
    session_id: s.session_id, group_title: s.group_title, starts_at: s.starts_at, moved: s.moved,
  }));
}

/**
 * Весь день сразу: утреннее письмо преподавателю. Оно же — ответ на любое
 * сообщение боту, если пишет преподаватель: своей семьи у Вари в студии
 * нет, и родительская неделя для неё пуста.
 */
export async function teacherDayView(teacherId: string, name: string | null): Promise<View> {
  const [today, unclosed] = await Promise.all([
    teacherSessions(teacherId),
    unclosedBefore(teacherId),
  ]);
  const hello = greeting(firstName(name));

  // Неотмеченное занятие это не забытая галочка, а непосчитанные деньги:
  // пока журнал не закрыт, начислений по нему нет. Увидеть это можно
  // только открыв сайт, поэтому напоминаем здесь.
  const tail = unclosed.length === 0 ? [] : [
    `Не отмечено за прошлые дни: ${unclosed.length}. Пока журнал не закрыт,`
      + ' деньги за эти занятия не посчитаны.',
    ...unclosed.map((s) => `   ${dayMonth(s.held_on)} · ${s.group_title}`),
    '',
  ];

  if (today.length === 0) {
    return {
      text: [hello, '', 'Сегодня занятий нет.', '', ...tail, wish()].join('\n'),
      keyboard: [],
    };
  }

  const blocks: string[][] = [];
  for (const s of today) {
    blocks.push(await sessionLines(s.session_id, s.group_title, s.starts_at, s.moved));
  }

  return {
    text: [hello, '', ...blocks.flatMap((b) => [...b, '']), ...tail, wish()].join('\n'),
    keyboard: [],
  };
}

/**
 * Одно занятие за час до начала. Отдельно от утреннего письма: за день
 * состав меняется, и к трём часам утренний список уже неправда.
 */
export async function teacherSessionView(
  sessionId: string, name: string | null,
): Promise<View | null> {
  const head = await one<{ title: string; at: string; kind: GroupKind; moved: boolean }>(
    `select g.title, coalesce(s.starts_at, g.starts_at)::text as at, g.kind,
            (s.starts_at is distinct from null
             and s.starts_at is distinct from g.starts_at) as moved
       from studio_sessions s join studio_groups g on g.id = s.group_id
      where s.id = $1 and s.status <> 'cancelled'`,
    [sessionId]);
  if (!head) return null;

  const lines = await sessionLines(sessionId, head.title, head.at, head.moved);
  // «Через час» верно только когда правда через час. По расписанию так и
  // есть, но это же сообщение можно попросить руками в любой момент, и
  // тогда обещать час нельзя.
  const mins = (t: string): number => {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
  };
  const left = mins(hhmm(head.at)) - mins(nowHM().hhmm);
  const lead = left > 0 && left <= 90 ? 'Через час:' : 'Сегодня:';
  return {
    text: [greeting(firstName(name)), '', lead, ...lines, '', wish()].join('\n'),
    keyboard: [],
  };
}

// ── Деньги ────────────────────────────────────────────────

/** Курс у студии пока один; продажи считаем по нему. */
const COURSE_SLUG = 'embroidery';

/** «2 покупки, 240 ₪ · 60 USD» — или «покупок нет». */
function salesLine(s: Sales): string {
  if (!s.count) return 'покупок нет';
  const sums = s.sums.map((x) => money(x.sum, x.currency)).join(' · ');
  const bought = `${s.count} ${plural(s.count, 'покупка', 'покупки', 'покупок')}`;
  return sums ? `${bought}, ${sums}` : bought;
}

/**
 * Деньги за месяц: сколько пришло и сколько студия за этот месяц
 * отработала. Две цифры нарочно стоят рядом и нарочно не сходятся:
 * касса — это когда заплатили, реализация — когда занятие прошло.
 * Абонемент, купленный в сентябре, кормит октябрь, а октябрьский долг
 * в кассу не попадёт вовсе, пока его не отдадут.
 */
export async function moneyMonthView(
  name: string | null, withPayouts = false,
): Promise<View> {
  const today = todayISO();
  const from = `${today.slice(0, 7)}-01`;
  const [taken, done, courseMonth, courseAll, payouts] = await Promise.all([
    takenBetween(from, today),
    periodStats(from, today),
    courseSales(COURSE_SLUG, from),
    courseSales(COURSE_SLUG, null),
    withPayouts ? payoutPlan(today) : null,
  ]);
  const cur = done.currency;
  const since = `с ${dayMonth(from)}`;

  const lesson = done.done.single.sum + done.done.pass.sum;
  const camp = done.done.event.sum + done.done.eventPass.sum;

  const lines = [
    greeting(firstName(name)),
    '',
    `Получено ${since}: ${money(Math.round(taken.sum), cur)}`,
    `   ${taken.count}\u00a0${plural(taken.count, 'платёж', 'платежа', 'платежей')}`,
    '',
    `Реализация ${since}:`,
    `   занятия — ${money(Math.round(lesson), cur)}`,
  ];
  // Лагерь показываем, только когда он был: строка «лагерь — 0» каждую
  // неделю говорила бы лишь о том, что сейчас не лето.
  if (camp > 0) lines.push(`   лагерь — ${money(Math.round(camp), cur)}`);
  lines.push(
    '',
    'Реализация — то, что прошло: деньги за это могли прийти раньше'
      + ' или ещё не прийти.',
    '',
    // Курс идёт отдельной строкой нарочно: его деньги лежат в своих
    // таблицах и в «Получено» выше не входят — там только касса студии.
    'Курс по вышивке:',
    `   ${since} — ${salesLine(courseMonth)}`,
  );
  // «Всего» показываем, только когда до этого месяца что-то продавалось:
  // иначе это та же строка второй раз. Месяц — часть всего времени, так
  // что равное число покупок значит равные суммы.
  if (courseAll.count !== courseMonth.count) {
    lines.push(`   всего — ${salesLine(courseAll)}`);
  }

  // Выплаты — деньги, которые уже заработаны, но лежат у Isracard.
  // В сводке их место рядом с кассой: это она, только с задержкой.
  if (payouts && payouts.upcoming.length > 0) {
    const ahead = payouts.upcoming.reduce((sum, p) => sum + p.net, 0);
    lines.push('', 'Isracard:');
    for (const p of payouts.upcoming.slice(0, PAYOUTS_SHOWN)) {
      lines.push(`   ${dayMonth(p.day)} — ${money(Math.round(p.net))}`);
    }
    const rest = payouts.upcoming.length - PAYOUTS_SHOWN;
    if (rest > 0) {
      lines.push(`   и ещё ${rest}\u00a0${plural(rest, 'выплата', 'выплаты', 'выплат')}`);
    }
    if (payouts.upcoming.length > 1) {
      lines.push(`   всего впереди ${money(Math.round(ahead))}`);
    }
  }

  return { text: lines.join('\n'), keyboard: [] };
}

/**
 * Приглашение в мини-приложение. Телеграм открывает его только из своей
 * кнопки: ссылкой в сообщении мини-приложение не открыть, поэтому и
 * нужна отдельная команда.
 */
export function statsView(origin: string): View {
  return {
    text: 'Статистика студии: занятия на сегодня, деньги за месяц,'
      + ' долги, курс и сам бот.',
    keyboard: [[{ text: 'Открыть', web_app: { url: `${origin}/tg/stats` } }]],
  };
}

/** Сколько ближайших выплат показывать прямо в сообщении. */
const PAYOUTS_SHOWN = 4;

/**
 * Кому писать про деньги кассы: админам. Преподавателю без этой роли
 * выплаты Isracard ни о чём не говорят, а Варя админ.
 */
export async function moneyWatchers(): Promise<Teacher[]> {
  return query<Teacher>(
    `select distinct u.id, u.name, u.tg_chat_id::text as chat_id
       from users u join user_roles r on r.user_id = u.id
      where r.role in ('admin', 'superadmin') and u.tg_chat_id is not null`);
}

/**
 * Накануне выплаты. Сумма названа примерной нарочно: график выведен из
 * договора, а не получен от Isracard, и разойтись он может на возвраты
 * и на оплаты, проведённые мимо сайта.
 */
export function payoutSoonView(p: Payout): View {
  return {
    text: [
      `Завтра выплата Isracard: ориентировочно ${money(Math.round(p.net))}.`,
      '',
      `${p.credits.length}\u00a0${plural(p.credits.length, 'платёж', 'платежа', 'платежей')}`
        + ` на ${money(Math.round(p.gross))}, комиссия ${money(Math.round(p.fee))}.`,
      '',
      'Сумма посчитана по договору. Точная — в кабинете Isracard,'
        + ' раздел будущих зачислений.',
    ].join('\n'),
    keyboard: [],
  };
}

/**
 * Деньги кассы: когда Isracard переведёт за оплату картой. Ближайшие
 * выплаты пишем прямо в сообщении — за ними и спрашивают, а открывать
 * ради трёх строк отдельный экран незачем. Экран остаётся под кнопкой:
 * там видно, кто платил и сколько съела комиссия.
 */
export async function payoutsView(origin: string): Promise<View> {
  const plan = await payoutPlan();
  const open: Keyboard = [[{ text: 'Подробнее', web_app: { url: `${origin}/tg/isracard` } }]];

  if (plan.upcoming.length === 0) {
    return {
      text: 'Isracard: впереди выплат нет, всё принятое картой уже пришло.',
      keyboard: open,
    };
  }

  const ahead = plan.upcoming.reduce((sum, p) => sum + p.net, 0);
  const lines = ['Isracard, ближайшие выплаты:', ''];
  for (const p of plan.upcoming.slice(0, PAYOUTS_SHOWN)) {
    lines.push(`${dayMonth(p.day)} — ${money(Math.round(p.net))}`
      + ` · ${p.credits.length}\u00a0${
        plural(p.credits.length, 'платёж', 'платежа', 'платежей')}`);
  }
  const rest = plan.upcoming.length - PAYOUTS_SHOWN;
  if (rest > 0) {
    lines.push(`и ещё ${rest}\u00a0${plural(rest, 'выплата', 'выплаты', 'выплат')} дальше`);
  }
  lines.push('', `Всего впереди ${money(Math.round(ahead))}. Суммы после комиссии.`);

  return { text: lines.join('\n'), keyboard: open };
}

/**
 * Свои долги и абонементы. Оплатить отсюда нельзя нарочно: выбрать, за
 * какие занятия платить, объявить наличные или взять абонемент можно
 * только в кабинете, и половина этого в боте превратилась бы в лабиринт.
 */
export async function payView(userId: string, origin: string): Promise<string> {
  const family = await familyOwners(userId);
  const [unpaid, passes] = await Promise.all([
    unpaidCharges(family),
    passBalances(family),
  ]);

  const lines: string[] = [];
  const mine = passes.filter((p) => p.left > 0 && !p.ended);
  for (const p of mine) {
    const what = p.group_id
      ? plural(p.left, 'день', 'дня', 'дней')
      : plural(p.left, 'занятие', 'занятия', 'занятий');
    lines.push(`${p.group_title ?? 'Абонемент'}: осталось ${p.left} ${what} из ${p.lessons_total}`
      + (p.valid_to ? `, до ${dayMonth(p.valid_to)}` : ''));
  }
  if (lines.length > 0) lines.push('');

  if (unpaid.length === 0) {
    lines.push('Неоплаченных занятий нет.');
    return lines.join('\n');
  }

  const total = unpaid.reduce((sum, c) => sum + Number(c.amount), 0);
  lines.push(`Не оплачено ${unpaid.length} ${
    plural(unpaid.length, 'занятие', 'занятия', 'занятий')} на ${
    money(total, unpaid[0].currency)}`, '');
  for (const c of unpaid) {
    // «Заявлено» значит, что родитель уже сказал «заплатил наличными», и
    // ждёт подтверждения. Без пометки он решил бы, что его не услышали.
    lines.push(`${dayMonth(c.held_on)} · ${c.who} · ${c.group_title} · ${
      money(c.amount, c.currency)}${c.declared ? ' · заявлено' : ''}`);
  }
  lines.push('', `Оплатить: ${origin}/account/pay`);
  return lines.join('\n');
}

/** Должники студии. То же, что на экране «Финансы», только короче. */
export async function debtorsView(origin: string): Promise<string> {
  const rows = await debtors();
  if (rows.length === 0) return 'Долгов нет.';

  const total = rows.reduce((sum, d) => sum + Number(d.amount), 0);
  const lines = [
    `Должников ${rows.length}, всего ${money(total, rows[0].currency)}`,
    '',
  ];
  for (const d of rows) {
    lines.push(`${d.name ?? d.email} · ${d.lessons} ${
      plural(d.lessons, 'занятие', 'занятия', 'занятий')} · ${
      money(d.amount, d.currency)} · с ${dayMonth(d.since)}`);
  }
  lines.push('', `Финансы: ${origin}/admin/studio/debts`);
  return lines.join('\n');
}

// ── Вечерний вопрос ───────────────────────────────────────

export type AskTarget = {
  chat_id: string;
  user_id: string;
  session_id: string;
  /** День занятия: вопрос задаётся про день целиком, а не про занятие. */
  held_on: string;
};

export type PackOut = {
  chat_id: string;
  pass_id: string;
  title: string;
  /** Сколько дней было в пакете: все они уже отмечены. */
  lessons_total: number;
  /** Цена докупаемого дня. */
  price: string;
  /** Дни смены, которые ещё впереди. */
  days: string[];
};

/**
 * У кого пакет смены кончился, а смена идёт. Про это молчать нельзя:
 * ребёнок приходит дальше, дни начисляются поштучно и дороже, а семья
 * узнаёт об этом в конце — если вообще заглянет в «Оплату».
 *
 * Пишем только тем, кому есть что предложить: цена докупаемого дня
 * задана, и пакет самый большой — меньший дешевле нарастить покупкой
 * большего, а это уже другой разговор.
 *
 * Сегодняшний день не считаем: сообщение уходит вечером, когда смена
 * за день уже прошла.
 */
export async function packOutTargets(): Promise<PackOut[]> {
  return query<PackOut>(
    `select u.tg_chat_id::text as chat_id, p.id as pass_id, g.title,
            p.lessons_total, g.extra_price::text as price,
            array(select s.held_on::text from studio_sessions s
                   where s.group_id = g.id and s.status <> 'cancelled'
                     and s.held_on > current_date
                   order by s.held_on) as days
       from passes p
       join studio_groups g on g.id = p.group_id
       join users u on u.id = p.owner_id
      where g.kind <> 'lesson' and g.active and g.extra_price is not null
        and u.tg_chat_id is not null
        and (p.valid_to is null or p.valid_to >= current_date)
        and (g.ends_on is null or g.ends_on >= current_date)
        /* Пакет израсходован весь. */
        and p.lessons_total <= (select count(*) from charges ch where ch.pass_id = p.id)
        /* И он самый большой из тех, что продаются в эту смену. */
        and p.lessons_total >= coalesce((
              select max((o->>'lessons')::int)
                from jsonb_array_elements(g.pass_offers) o), 0)
        /* Впереди есть куда ходить. */
        and exists (select 1 from studio_sessions s
                     where s.group_id = g.id and s.status <> 'cancelled'
                       and s.held_on > current_date)`,
  );
}

export type PassOut = {
  chat_id: string;
  pass_id: string;
  /** Сколько занятий было в абонементе: все они уже отмечены. */
  lessons_total: number;
};

/**
 * У кого абонемент истрачен весь, а срок ещё идёт. Дальше ребёнок ходит
 * за поштучную цену, и семья узнаёт об этом из долга в «Оплате» — через
 * неделю, а то и позже.
 *
 * Абонемент тут обычный, не пакет смены: про смену говорит packOut, и
 * условия у них разные настолько, что общий запрос вышел бы хитрее
 * двух простых.
 *
 * Тому, у кого рядом лежит другой действующий абонемент, не пишем:
 * истратить старый и жить вторым — обычное дело, и «абонемент кончился»
 * в такой день читается как ошибка.
 */
export async function passOutTargets(): Promise<PassOut[]> {
  return query<PassOut>(
    `select u.tg_chat_id::text as chat_id, p.id as pass_id, p.lessons_total
       from passes p
       join users u on u.id = p.owner_id
      where p.group_id is null
        and u.tg_chat_id is not null
        and (p.valid_to is null or p.valid_to >= current_date)
        /* Истрачен весь. */
        and p.lessons_total <= (select count(*) from charges ch where ch.pass_id = p.id)
        /* И заменить его нечем. */
        and not exists (
          select 1 from passes q
           where q.owner_id = p.owner_id and q.group_id is null and q.id <> p.id
             and (q.valid_to is null or q.valid_to >= current_date)
             and q.lessons_total > (select count(*) from charges ch where ch.pass_id = q.id))`,
  );
}

export type PassEnds = {
  chat_id: string;
  pass_id: string;
  /** Сколько занятий сгорит вместе со сроком. */
  left: number;
  valid_to: string;
};

/**
 * У кого срок абонемента на исходе, а занятия в нём остались. Кабинет
 * про это говорит за неделю, но в кабинет заходят раз в месяц, и
 * сгоревшие занятия родитель обнаруживает задним числом.
 *
 * Срок считаем по дням, а не по часам: абонемент кончается днём, а не
 * минутой, и «осталось 0 дней» значит «сегодня последний».
 */
export async function passEndsTargets(): Promise<PassEnds[]> {
  return query<PassEnds>(
    `select u.tg_chat_id::text as chat_id, p.id as pass_id,
            p.valid_to::text as valid_to,
            (p.lessons_total
              - (select count(*) from charges ch where ch.pass_id = p.id))::int as left
       from passes p
       join users u on u.id = p.owner_id
      where p.group_id is null
        and u.tg_chat_id is not null
        and p.valid_to is not null
        and p.valid_to >= current_date
        and p.valid_to <= current_date + $1::int
        /* Есть чему сгорать. */
        and p.lessons_total > (select count(*) from charges ch where ch.pass_id = p.id)`,
    [PASS_WARN_DAYS],
  );
}

/** Письмо про кончившийся абонемент. */
export function passOutView(
  t: PassOut, price: { amount: number; currency: string }, origin: string,
): { text: string } {
  return {
    text: [
      `В абонементе закончились занятия: все ${t.lessons_total} отмечены.`,
      '',
      `Следующее занятие посчитается по базовой цене, ${money(price.amount, price.currency)}.`,
      '',
      `Новый абонемент: ${origin}/account/pay`,
    ].join('\n'),
  };
}

/** Письмо про сгорающий срок. */
export function passEndsView(t: PassEnds, today: string, origin: string): { text: string } {
  const days = daysUntil(t.valid_to, today);
  const when = days === 0
    ? 'срок заканчивается сегодня'
    : `срок заканчивается через ${days} ${plural(days, 'день', 'дня', 'дней')}, ${
        dayMonth(t.valid_to)}`;
  return {
    text: [
      `В абонементе осталось ${t.left} ${
        plural(t.left, 'занятие', 'занятия', 'занятий')}, а ${when}.`,
      '',
      'Неиспользованные занятия сгорают. Записаться на ближайшие дни можно'
        + ' здесь, командой /week.',
      '',
      `Абонемент: ${origin}/account/pay`,
    ].join('\n'),
  };
}

/** Письмо про кончившийся пакет. Дни перечисляем: их два-три, не список. */
export function packOutView(t: PackOut, origin: string): { text: string } {
  const n = t.days.length;
  const when = n <= 3
    ? t.days.map((d) => dayMonth(d)).join(', ')
    : `${dayMonth(t.days[0])} — ${dayMonth(t.days[n - 1])}`;
  return {
    text: [
      `В пакете «${t.title}» закончились дни: все ${t.lessons_total} отмечены.`,
      '',
      `Впереди ещё ${n} ${plural(n, 'день', 'дня', 'дней')}: ${when}.`
        + ` День можно докупить за ${money(t.price, 'ILS')} — это дешевле,`
        + ' чем платить за него отдельно.',
      '',
      `Докупить: ${origin}/account/pay`,
    ].join('\n'),
  };
}

/**
 * Кому завтра задавать вопрос. Спрашиваем только тех, чей ответ что-то
 * меняет: занятие завтра есть, записи на него нет, а основание ждать —
 * есть. Записавшимся не пишем ничего: вопрос без смысла обесценивает
 * все остальные, и через месяц их перестанут читать.
 *
 * Основание ждать — одно из двух: ребёнка приводили на это же занятие в
 * последние две недели или этот день отмечен у него в профиле. Первого
 * достаточно тем, кто ходит и профиль не заполнял; второго — новичкам,
 * которых в журнале ещё нет.
 *
 * Занятий в дне бывает два; вопрос всё равно один и рассказывает про
 * оба — какое из них выбрать, решает семья, а не мы.
 */
export async function askTargets(): Promise<AskTarget[]> {
  return query<AskTarget>(
    `select distinct u.tg_chat_id::text as chat_id, u.id as user_id, s.id as session_id,
            s.held_on::text
       from studio_sessions s
       join studio_groups g on g.id = s.group_id and g.active and g.kind = 'lesson'
       join participants p
         on (g.audience = 'adults' and p.user_id is not null)
         or (g.audience = 'kids' and p.child_id is not null)
       left join children ch on ch.id = p.child_id
       left join users pu on pu.id = p.user_id
       /* Пишем каждому взрослому, кто отвечает за этого участника: сам
          он это или его опекуны, которых может быть двое. */
       join users u
         on (p.user_id is not null and u.id = p.user_id)
         or (p.child_id is not null
             and exists (select 1 from guardians gg
                          where gg.child_id = p.child_id and gg.user_id = u.id))
      where s.held_on = current_date + 1
        and s.status <> 'cancelled'
        and ch.archived_at is null
        and (p.user_id is null or pu.attends)
        and u.tg_chat_id is not null
        and not exists (select 1 from bookings b
                         where b.session_id = s.id and b.participant_id = p.id
                           and b.status = 'booked')
        and (exists (select 1 from attendance a
                       join studio_sessions s2 on s2.id = a.session_id
                      where a.participant_id = p.id and a.status = 'present'
                        and s2.group_id = g.id and s2.held_on > current_date - 14)
          or exists (select 1 from preferred_days pd
                      where pd.participant_id = p.id and pd.weekday = g.weekday))`,
  );
}

/**
 * Кого спросить ещё раз утром: занятие сегодня, человек не записан и
 * вечером не отказался. Вечерний вопрос приходит в семь, когда день
 * кончился и отвечать некогда; к утру про него забывают.
 *
 * Отказавшихся не трогаем: они ответили, и второй вопрос читался бы
 * как «мы тебе не поверили». Занятие, до которого меньше часа, тоже
 * пропускаем — собраться уже не успеть.
 */
export async function askAgainTargets(): Promise<AskTarget[]> {
  return query<AskTarget>(
    `select distinct u.tg_chat_id::text as chat_id, u.id as user_id, s.id as session_id,
            s.held_on::text
       from studio_sessions s
       join studio_groups g on g.id = s.group_id and g.active and g.kind = 'lesson'
       join participants p
         on (g.audience = 'adults' and p.user_id is not null)
         or (g.audience = 'kids' and p.child_id is not null)
       left join children ch on ch.id = p.child_id
       left join users pu on pu.id = p.user_id
       join users u
         on (p.user_id is not null and u.id = p.user_id)
         or (p.child_id is not null
             and exists (select 1 from guardians gg
                          where gg.child_id = p.child_id and gg.user_id = u.id))
      where s.held_on = current_date
        and s.status <> 'cancelled'
        and ch.archived_at is null
        and (p.user_id is null or pu.attends)
        and u.tg_chat_id is not null
        and (s.held_on + g.starts_at) > now() + interval '1 hour'
        /* Ни записи, ни отказа: человек промолчал. */
        and not exists (select 1 from bookings b
                         where b.session_id = s.id and b.participant_id = p.id)
        and (exists (select 1 from attendance a
                       join studio_sessions s2 on s2.id = a.session_id
                      where a.participant_id = p.id and a.status = 'present'
                        and s2.group_id = g.id and s2.held_on > current_date - 14)
          or exists (select 1 from preferred_days pd
                      where pd.participant_id = p.id and pd.weekday = g.weekday))`,
  );
}

/**
 * Сам вопрос: одно занятие, семья под ним, по две кнопки на каждого.
 * Коротко — в отличие от недели, это сообщение приходит само и вечером,
 * и простыня на семь дней тут не к месту.
 *
 * null — от занятия ничего не осталось: отменили или семья к нему уже
 * не подходит. Такое сообщение слать не за чем.
 */
export async function askView(userId: string, sessionId: string): Promise<View | null> {
  const when = await one<{ held_on: string }>(
    'select held_on::text from studio_sessions where id = $1', [sessionId]);
  if (!when) return null;

  // Занятий в дне бывает два, и спрашиваем сразу про оба: семья вправе
  // выбрать другое время, а два сообщения за вечер про один и тот же
  // день читаются как поломка бота.
  const rows = (await slotsForUser(userId, when.held_on, when.held_on))
    .filter((r) => r.kind === 'lesson');
  if (rows.length === 0) return null;

  // Отказ тоже хранится строкой, поэтому «не придёт» отличимо от
  // «промолчал»: у первого есть отменённая запись, у второго нет ничего.
  const said = new Map<string, string>();
  for (const r of await query<{ session_id: string; participant_id: string; status: string }>(
    `select b.session_id, b.participant_id, b.status
       from bookings b join studio_sessions s on s.id = b.session_id
      where s.held_on = $1::date`, [when.held_on])) {
    said.set(`${r.session_id}|${r.participant_id}`, r.status);
  }

  const sessions = [...new Map(rows.map((r) => [r.session_id, r])).values()];
  const places = (r: SlotRow): string => {
    const free = r.capacity === null ? null : Math.max(r.capacity - r.taken, 0);
    if (free === null) return '';
    return free === 0 ? 'мест нет' : `свободно ${free} из ${r.capacity}`;
  };

  // Утреннее напоминание шлёт этот же вид, а «завтра» в день занятия —
  // прямая ложь. Слово берём из даты, а не из того, кто нас позвал.
  const lines = [when.held_on === todayISO() ? 'Кто придёт сегодня?' : 'Кто придёт завтра?'];
  if (sessions.length === 1) {
    const only = sessions[0];
    lines.push([weekdayDayMonth(only.held_on), hhmm(only.starts_at), places(only)]
      .filter(Boolean).join(' · '));
  } else {
    lines.push(weekdayDayMonth(when.held_on));
    lines.push('');
    for (const x of sessions) lines.push([hhmm(x.starts_at), places(x)].filter(Boolean).join(' · '));
  }
  lines.push('');

  const byWho = new Map<string, SlotRow[]>();
  for (const r of rows) byWho.set(r.participant_id, [...(byWho.get(r.participant_id) ?? []), r]);

  const buttons: Button[] = [];
  for (const mine of byWho.values()) {
    const going = mine.filter((r) => r.booked);
    const state = going.length > 0
      ? (sessions.length === 1
        ? 'придёт'
        : `придёт в ${going.map((r) => hhmm(r.starts_at)).join(' и ')}`)
      : mine.some((r) => said.get(`${r.session_id}|${r.participant_id}`) === 'cancelled')
        ? 'не придёт'
        : 'не отмечено';
    lines.push(`${mine[0].who} — ${state}`);

    for (const r of mine) {
      // Время на кнопке — только когда занятий в дне несколько: иначе
      // оно повторяет шапку и съедает место под именем.
      const at = sessions.length === 1 ? '' : ` · ${hhmm(r.starts_at)}`;
      const free = r.capacity === null ? null : Math.max(r.capacity - r.taken, 0);
      // Обе кнопки стоят всегда: ответ можно поменять до самого занятия.
      // Занять последнее место может только тот, кто ещё не записан.
      if (!r.booked && free === 0) {
        buttons.push({ text: `${r.who}${at} · мест нет`, callback_data: tapData(r, false, 'ask') });
      } else {
        buttons.push({
          text: `${r.booked ? '✓ ' : ''}${r.who}${at} · придёт`,
          callback_data: tapData(r, true, 'ask'),
        });
      }
      const no = said.get(`${r.session_id}|${r.participant_id}`) === 'cancelled' && !r.booked;
      buttons.push({
        text: `${no ? '✓ ' : ''}${r.who}${at} · не придёт`,
        callback_data: tapData(r, false, 'ask'),
      });
    }
  }

  return { text: lines.join('\n'), keyboard: rows2(buttons) };
}

/**
 * Что перерисовать после нажатия. Кнопка лагеря живёт в сообщении про
 * лагерь, кнопка занятия — в неделе; перепутать их значит стереть
 * родителю не то сообщение.
 */
export async function viewAfterTap(
  userId: string, tap: Tap, origin: string,
): Promise<View> {
  // Вопрос перерисовывается в себя: родитель читал короткое «кто придёт
  // завтра», и подменять его недельной простынёй нельзя.
  if (tap.from === 'ask') {
    const asked = await askView(userId, tap.sessionId);
    if (asked) return asked;
  }
  const sessionId = tap.sessionId;
  const row = await one<{ kind: GroupKind; group_id: string }>(
    `select g.kind, g.id as group_id
       from studio_sessions s join studio_groups g on g.id = s.group_id
      where s.id = $1`,
    [sessionId]);
  if (row && row.kind !== 'lesson') {
    const found = (await eventViews(userId, origin)).find((v) => v.groupId === row.group_id);
    if (found) return found;
  }
  return weekView(userId, origin);
}

/**
 * Записать или снять запись по нажатию. Возвращает короткую строку для
 * всплывающей подсказки над кнопкой.
 *
 * Права и прошедший день проверяются здесь, а не на кнопке: кнопка
 * могла быть нарисована час назад, и с тех пор всё изменилось.
 */
export async function applyTap(userId: string, tap: Tap): Promise<string> {
  if (!(await ownsParticipant(userId, tap.participantId))) return 'Это не ваш участник.';
  if (tap.book && (await sessionIsPast(tap.sessionId))) return 'День уже прошёл.';
  const res = await setBooking(tap.sessionId, tap.participantId, tap.book,
    { userId, via: 'bot' });
  if (!res.ok) return res.reason ?? 'Не получилось.';
  // «Не придёт» из вечернего вопроса — это ответ, и Варя увидит его
  // отдельной строкой. Снятая запись в недельном списке ответом не
  // считается: человек просто передумал, никому ничего не обещая.
  if (!tap.book && tap.from === 'ask') await markDeclined(tap.sessionId, tap.participantId);
  return tap.book ? 'Записали' : 'Отменили';
}

// ── Чеки: снимок от Вари превращается в расход ────────────

/**
 * Забирает файл из телеграма. Два шага: сперва спрашиваем путь, потом
 * качаем. Второй запрос идёт не на обычный адрес API, а на файловый.
 */
export async function fileBytes(fileId: string): Promise<Buffer | null> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return null;
  const res = await call<{ file_path?: string }>('getFile', { file_id: fileId });
  const path = res.ok ? res.result?.file_path : null;
  if (!path) return null;
  try {
    const file = await fetch(`${API}/file/bot${token}/${path}`, {
      signal: AbortSignal.timeout(20_000),
    });
    if (!file.ok) return null;
    return Buffer.from(await file.arrayBuffer());
  } catch {
    return null;
  }
}

/** Нажатие на карточке чека: выбор группы или отказ. */
export type ExpenseTap = { expenseId: string; kindId: string | null };

export function readExpenseTap(data: string): ExpenseTap | null {
  const drop = /^ed([A-Za-z0-9_-]{22})$/.exec(data);
  if (drop) {
    const expenseId = unpackId(drop[1]);
    return expenseId ? { expenseId, kindId: null } : null;
  }
  const pick = /^e([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{22})$/.exec(data);
  if (!pick) return null;
  const expenseId = unpackId(pick[1]);
  const kindId = unpackId(pick[2]);
  return expenseId && kindId ? { expenseId, kindId } : null;
}

export type ReceiptCard = {
  supplier: string | null;
  supplier_en?: string | null;
  /** Вывеска магазина: её человек узнаёт, фирму — нет. */
  trade_name?: string | null;
  trade_name_en?: string | null;
  /** Числом из модели или строкой из базы: деньги печатаются одинаково. */
  amount: string | number | null;
  vat: string | number | null;
  currency: string;
  spent_on: string | null;
  doc_number: string | null;
  what: string | null;
};

/** Как называются машинные группы по-русски. Порядок — от крупного. */
const GUESS_WORD: Record<string, string> = {
  materials: 'материалы',
  stationery: 'канцелярия',
  equipment: 'оборудование',
  food: 'еда',
  other: 'прочее',
};

const DOC_WORD: Record<string, string> = {
  invoice: 'счёт-фактура',
  invrec: 'счёт-квитанция',
  receipt: 'квитанция',
  other: 'документ',
};

/**
 * Карточка разобранного чека. Показываем ровно то, что уйдёт в
 * бухгалтерию, и спрашиваем единственное, чего модель знать не может, —
 * к какой статье затрат это отнести.
 */
export function receiptCard(
  id: string,
  e: ReceiptCard & { doc_type?: string | null },
  groups: { id: string; title: string; slug?: string | null }[],
  split?: { parts: { kind: string; sum: number }[]; sum: number },
): View {
  const sum = e.amount
    ? `${cents(e.amount, e.currency)}${e.vat ? `, НДС ${cents(e.vat, e.currency)}` : ''}`
    : 'сумма не разобрана';
  const shop = shopName({
    supplier: e.supplier, supplier_en: e.supplier_en ?? null,
    trade_name: e.trade_name ?? null, trade_name_en: e.trade_name_en ?? null,
  });
  const lines = [
    `<b>${esc(shop.title)}</b>`,
    ...(shop.sub ? [esc(shop.sub)] : []),
    sum,
    [
      e.spent_on ? dayMonth(e.spent_on) : 'дата не разобрана',
      e.doc_type ? DOC_WORD[e.doc_type] ?? e.doc_type : null,
      e.doc_number ? `№ ${esc(e.doc_number)}` : null,
    ].filter(Boolean).join(' · '),
  ];
  // Прикидка по строкам: сколько из похода в магазин было материалами,
  // а сколько едой. Это показания модели, поэтому тут же говорим, сошлись
  // ли строки с итогом: сошлись — значит, прочитаны все.
  if (split?.parts.length) {
    lines.push('', split.parts
      .map((p) => `${GUESS_WORD[p.kind] ?? p.kind} ${cents(p.sum, e.currency)}`)
      .join(' · '));
    const total = Number(e.amount ?? 0);
    const off = Math.abs(split.sum - total);
    if (total > 0 && off >= 0.01) {
      lines.push(`строки дают ${cents(split.sum, e.currency)} — на ${
        cents(off, e.currency)} меньше итога`);
    }
  } else if (e.what) {
    lines.push('', esc(e.what));
  }

  lines.push('', 'К какой статье отнести весь чек?');

  // Статью, которой в чеке больше всего, ставим первой и одну в ряд: чаще
  // всего нажмут именно её, и выбирать из шести ради этого незачем.
  const top = split?.parts[0]?.kind ?? null;
  const guessed = top ? groups.find((g) => g.slug === top) ?? null : null;
  const rest = groups.filter((g) => g !== guessed);

  const button = (g: { id: string; title: string }) => ({
    text: g.title,
    callback_data: `e${packId(id)}.${packId(g.id)}`,
  });

  const keyboard: Keyboard = [];
  if (guessed) keyboard.push([button(guessed)]);
  // Остальные по две в ряд: названия длинные, в три кнопки строка не влезает.
  for (let i = 0; i < rest.length; i += 2) keyboard.push(rest.slice(i, i + 2).map(button));
  keyboard.push([{ text: 'Не проводить', callback_data: `ed${packId(id)}` }]);

  return { text: lines.join('\n'), keyboard, html: true };
}
