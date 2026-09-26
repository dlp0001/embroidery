import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { one, query, tx } from './db';
import {
  dayMonth, hhmm, money, nowHM, packageFrom, plural, plusDays, todayISO, weekdayDayMonth,
} from './format';
import {
  eventSlotsForUser, markDeclined, sessionIsPast, setBooking, slotsForUser, teacherSessions,
  unclosedBefore,
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
export type Button = { text: string; callback_data: string };
export type Keyboard = Button[][];

export async function send(chatId: number, text: string, keyboard?: Keyboard): Promise<boolean> {
  return (await sendAndGetId(chatId, text, keyboard)) !== null;
}

/** То же, но отдаёт номер сообщения: на него потом отвечают. */
export async function sendAndGetId(
  chatId: number, text: string, keyboard?: Keyboard,
): Promise<number | null> {
  const res = await call<{ message_id: number }>('sendMessage', {
    chat_id: chatId,
    text,
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
  chatId: number, messageId: number, text: string, keyboard?: Keyboard,
): Promise<void> {
  const res = await call('editMessageText', {
    chat_id: chatId,
    message_id: messageId,
    text,
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
 * Ссылка привязки. Одноразовая, на четверть часа, и это единственный
 * способ связать чат с учёткой. Ни по почте, ни по нику, ни по номеру
 * телефона: иначе к чужой семье с детьми и долгами привяжется
 * посторонний, назвавший чужой адрес.
 */
export async function linkUrl(userId: string): Promise<string | null> {
  const bot = process.env.TELEGRAM_BOT_NAME;
  if (!bot) return null;
  // base64url: в start телеграм пускает латиницу, цифры, дефис и
  // подчёркивание, и не больше 64 знаков. Двадцать четыре байта дают 32.
  const raw = randomBytes(24).toString('base64url');
  await query(
    `insert into tg_links (user_id, token_hash, expires_at)
     values ($1, $2, now() + ($3 || ' minutes')::interval)`,
    [userId, hashToken(raw), String(LINK_TTL_MIN)],
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

/**
 * Сколько мест осталось. Своей записи «мест нет» не пишем: место уже
 * занято вами. Правило то же, что в SlotList на экране кабинета, — если
 * меняете здесь, поменяйте и там, иначе бот и сайт начнут считать
 * места по-разному.
 */
function seats(row: SlotRow, someoneBooked: boolean): string | null {
  if (row.capacity === null) return null;
  const free = Math.max(row.capacity - row.taken, 0);
  if (free > 0) return `мест: ${free}`;
  return someoneBooked ? null : 'мест нет';
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
  const buttons: Button[] = [];
  for (const r of rows) {
    // День прошёл — обещать приход поздно. Мест нет — записаться некуда,
    // но свою запись снять можно всегда.
    if (r.held_on < today) continue;
    const free = r.capacity === null ? null : Math.max(r.capacity - r.taken, 0);
    if (!r.booked && free === 0) continue;
    buttons.push({
      text: `${r.booked ? '✓ ' : ''}${shortDay(r.held_on)} · ${r.who}`,
      callback_data: tapData(r, !r.booked, 'list'),
    });
  }
  return buttons;
}

function renderSlots(
  rows: SlotRow[], today: string, withTag: boolean,
): { lines: string[]; buttons: Button[] } {
  // Порядок строк задаёт база, но два занятия в одно время на одном дне
  // могли бы перемешаться именами. Группируем, как это делает SlotList.
  const bySession = new Map<string, SlotRow[]>();
  for (const r of rows) bySession.set(r.session_id, [...(bySession.get(r.session_id) ?? []), r]);

  const lines: string[] = [];
  const buttons: Button[] = [];
  let day = '';

  for (const people of bySession.values()) {
    const head = people[0];
    if (head.held_on !== day) {
      day = head.held_on;
      lines.push('', weekdayDayMonth(day));
    }
    const free = head.capacity === null ? null : Math.max(head.capacity - head.taken, 0);
    const parts = [hhmm(head.starts_at)];
    if (head.moved) parts.push('перенесено');
    // Внутри сообщения про смену пометка «лагерь» стоит на каждой строке
    // и перестаёт что-либо значить: она уже в заголовке.
    const what = withTag ? tag(head) : null;
    if (what) parts.push(what);
    const left = seats(head, people.some((p) => p.booked));
    if (left) parts.push(left);
    lines.push(parts.join(' · '));

    for (const p of people) {
      lines.push(`   ${p.who}${p.booked ? ' — придёт' : ''}`);
      // День прошёл — обещать приход поздно. Мест нет — записаться некуда,
      // но свою запись снять можно всегда.
      if (head.held_on < today) continue;
      if (!p.booked && free === 0) continue;
      buttons.push({
        text: `${p.booked ? '✓ ' : ''}${shortDay(head.held_on)} · ${p.who}`,
        callback_data: tapData(p, !p.booked, 'list'),
      });
    }
  }
  return { lines, buttons };
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
  const { lines, buttons } = renderSlots(rows, today, true);
  return {
    text: [
      'Ближайшая неделя',
      ...lines,
      '',
      'Галочка — записан. Нажмите, чтобы записать или отменить.',
      `Оплата, история и остальное: ${origin}/account`,
    ].join('\n'),
    keyboard: rows2(buttons),
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

    const from = packageFrom(Number(head.price), head.pass_offers);
    const top = [
      title,
      `${dayMonth(days[0].held_on)} — ${dayMonth(days[days.length - 1].held_on)} · ${hhmm(usual)}`,
      '',
      `День стоит ${money(Number(head.price), 'ILS')}${
        head.capacity ? `, мест в день ${head.capacity}` : ''}.`,
      from === null
        ? 'Платится за те дни, в которые ребёнок пришёл.'
        : `Если планируете ${from} ${plural(from, 'день', 'дня', 'дней')} и больше, выгоднее`
          + ' взять пакет: он покупается в «Оплате».',
    ];

    // Дни списком, а не карточками: какой день и кто на него идёт, видно
    // по кнопкам, и повторять это ещё и текстом значит получить полотно
    // на полсотни строк. Текстом остаётся то, чего на кнопке не написать,
    // — сколько мест свободно.
    const left = days
      .filter((d) => d.held_on >= today)
      .map((d) => {
        const free = d.capacity === null ? null : Math.max(d.capacity - d.taken, 0);
        const when = d.starts_at === usual ? '' : ` (${hhmm(d.starts_at)})`;
        if (free === null) return `${shortDay(d.held_on)}${when}`;
        return `${shortDay(d.held_on)}${when} — ${free === 0 ? 'нет мест' : free}`;
      });
    if (left.length > 0) top.push('', `Свободно: ${left.join(', ')}`);

    // Сколько дней уже отмечено у каждого: от этого зависит, брать пакет
    // или платить поштучно, и считать это по галочкам в уме не надо.
    const picked = [...new Map(slots.map((s) => [s.participant_id, s.who])).entries()]
      .map(([id, who]) => {
        const n = slots.filter((s) => s.participant_id === id && s.booked).length;
        return n > 0 ? `${who} — ${n} ${plural(n, 'день', 'дня', 'дней')}` : null;
      })
      .filter((x): x is string => x !== null);
    top.push('', picked.length > 0 ? `Отмечено: ${picked.join(', ')}` : 'Пока ничего не отмечено.');

    out.push({
      groupId: head.group_id,
      text: [...top, '', 'Галочка — записан. Нажмите, чтобы отметить дни.',
             `Пакет и оплата: ${origin}/account/pay`].join('\n'),
      // У смены кнопки идут блоками по человеку, а не вперемешку по дням:
      // родитель отмечает все дни одному ребёнку подряд, и в списке из
      // тридцати кнопок это единственный способ не сбиться.
      keyboard: rows2(slotButtons(
        [...slots].sort((a, b) => a.who.localeCompare(b.who) || a.held_on.localeCompare(b.held_on)),
        today,
      )),
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

type RosterRow = { who: string; booking: string; declined: boolean; preferred: boolean };

/**
 * Кого ждать на занятии. Состав тот же, что в журнале у Вари: все, кто
 * подходит занятию по типу. Различаем три вещи, потому что они означают
 * разное: записался, обычно ходит, но молчит, и прямо сказал «не придём».
 */
async function roster(sessionId: string): Promise<RosterRow[]> {
  return query<RosterRow>(
    `with ses as (
       select s.id, g.audience, g.kind, extract(isodow from s.held_on)::int as dow
         from studio_sessions s join studio_groups g on g.id = s.group_id
        where s.id = $1
     )
     select coalesce(ch.name, u.name, 'Без имени') as who,
            coalesce(b.status, '') as booking,
            (b.declined_at is not null) as declined,
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
  const usual = rows
    .filter((r) => r.preferred && r.booking === '')
    .map((r) => r.who);

  // Перенос ставим сразу за временем: на эту строку и смотрят, решая,
  // когда быть в студии.
  const lines = [`${hhmm(at)}${moved ? ' · перенесено' : ''} · ${title}`];
  lines.push(coming.length > 0
    ? `Записались (${coming.length}): ${coming.join(', ')}`
    : 'Записанных нет.');
  if (usual.length > 0) lines.push(`Обычно ходят, но не отметились: ${usual.join(', ')}`);
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

// ── Вечерний вопрос ───────────────────────────────────────

export type AskTarget = { chat_id: string; user_id: string; session_id: string };

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
 */
export async function askTargets(): Promise<AskTarget[]> {
  return query<AskTarget>(
    `select distinct u.tg_chat_id::text as chat_id, u.id as user_id, s.id as session_id
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

  const rows = (await slotsForUser(userId, when.held_on, when.held_on))
    .filter((r) => r.session_id === sessionId);
  if (rows.length === 0) return null;

  // Отказ тоже хранится строкой, поэтому «не придёт» отличимо от
  // «промолчал»: у первого есть отменённая запись, у второго нет ничего.
  const said = new Map<string, string>();
  for (const r of await query<{ participant_id: string; status: string }>(
    'select participant_id, status from bookings where session_id = $1', [sessionId])) {
    said.set(r.participant_id, r.status);
  }

  const head = rows[0];
  const free = head.capacity === null ? null : Math.max(head.capacity - head.taken, 0);
  const lines = [
    'Кто придёт завтра?',
    `${weekdayDayMonth(head.held_on)} · ${hhmm(head.starts_at)}`
      + (free === null ? '' : ` · ${free === 0 ? 'мест нет' : `свободно ${free} из ${head.capacity}`}`),
    '',
  ];

  const buttons: Button[] = [];
  for (const r of rows) {
    const state = r.booked ? 'придёт'
      : said.get(r.participant_id) === 'cancelled' ? 'не придёт'
      : 'не отмечено';
    lines.push(`${r.who} — ${state}`);
    // Обе кнопки стоят всегда: ответ можно поменять до самого занятия.
    // Занять последнее место может только тот, кто ещё не записан.
    if (!r.booked && free === 0) {
      buttons.push({ text: `${r.who} · мест нет`, callback_data: tapData(r, false, 'ask') });
    } else {
      buttons.push({
        text: `${r.booked ? '✓ ' : ''}${r.who} · придёт`,
        callback_data: tapData(r, true, 'ask'),
      });
    }
    buttons.push({
      text: `${said.get(r.participant_id) === 'cancelled' && !r.booked ? '✓ ' : ''}${r.who} · не придёт`,
      callback_data: tapData(r, false, 'ask'),
    });
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
