import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { one, query, tx } from './db';
import {
  dayMonth, hhmm, money, packageFrom, plural, plusDays, todayISO, weekdayDayMonth,
} from './format';
import {
  eventSlotsForUser, sessionIsPast, setBooking, slotsForUser,
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
  const res = await call<{ message_id: number }>('sendMessage', {
    chat_id: chatId,
    text,
    link_preview_options: { is_disabled: true },
    ...(keyboard?.length ? { reply_markup: { inline_keyboard: keyboard } } : {}),
  });
  if (res.ok) return true;
  if (res.code === 403) {
    await forgetChat(chatId);
    console.log('telegram: бот заблокирован, привязка снята');
    return false;
  }
  console.error('telegram: сообщение не ушло', res.code, res.why);
  return false;
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

export type Bound = { ok: true; name: string | null } | { ok: false };

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
  return { ok: true, name };
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
function pack(id: string): string {
  return Buffer.from(id.replace(/-/g, ''), 'hex').toString('base64url');
}

function unpack(s: string): string | null {
  const b = Buffer.from(s, 'base64url');
  if (b.length !== 16) return null;
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export type Tap = { sessionId: string; participantId: string; book: boolean };

/** Разбор нажатия. Всё, что пришло не от нашей кнопки, — мусор. */
export function readTap(data: string): Tap | null {
  const m = /^b([01]):([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{22})$/.exec(data);
  if (!m) return null;
  const sessionId = unpack(m[2]);
  const participantId = unpack(m[3]);
  if (!sessionId || !participantId) return null;
  return { sessionId, participantId, book: m[1] === '1' };
}

function tapData(row: SlotRow): string {
  return `b${row.booked ? '0' : '1'}:${pack(row.session_id)}.${pack(row.participant_id)}`;
}

/**
 * Участник из семьи этого взрослого? Проверка та же, что в кабинете:
 * в callback_data приезжает что угодно, и верить ей нельзя.
 */
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

export type View = { text: string; keyboard: Keyboard };

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
      callback_data: tapData(r),
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
        callback_data: tapData(p),
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

/**
 * Что перерисовать после нажатия. Кнопка лагеря живёт в сообщении про
 * лагерь, кнопка занятия — в неделе; перепутать их значит стереть
 * родителю не то сообщение.
 */
export async function viewAfterTap(
  userId: string, sessionId: string, origin: string,
): Promise<View> {
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
  const res = await setBooking(tap.sessionId, tap.participantId, tap.book);
  if (!res.ok) return res.reason ?? 'Не получилось.';
  return tap.book ? 'Записали' : 'Отменили';
}
