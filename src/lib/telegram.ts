import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { one, query, tx } from './db';
import { hhmm, plusDays, todayISO, weekdayDayMonth } from './format';
import { slotsForUser, type SlotRow } from './studio';

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
export async function send(chatId: number, text: string): Promise<boolean> {
  const res = await call<{ message_id: number }>('sendMessage', {
    chat_id: chatId,
    text,
    link_preview_options: { is_disabled: true },
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

// ── Тексты ────────────────────────────────────────────────

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

/**
 * Ближайшая неделя семьи одним сообщением. Читается сверху вниз, как
 * экран кабинета: день, занятие, имена под ним. Кнопок пока нет,
 * записываются на сайте.
 */
export async function weekText(userId: string, origin: string): Promise<string> {
  const today = todayISO();
  const rows = (await slotsForUser(userId, today, plusDays(today, 7)))
    .filter((r) => r.kind === 'lesson');
  if (rows.length === 0) {
    return `На ближайшую неделю занятий нет.\n\nРасписание целиком: ${origin}/account/calendar`;
  }

  // Порядок строк задаёт база, но два занятия в одно время на одном дне
  // могли бы перемешаться именами. Группируем, как это делает SlotList.
  const bySession = new Map<string, SlotRow[]>();
  for (const r of rows) bySession.set(r.session_id, [...(bySession.get(r.session_id) ?? []), r]);

  const lines: string[] = ['Ближайшая неделя'];
  let day = '';
  for (const people of bySession.values()) {
    const head = people[0];
    if (head.held_on !== day) {
      day = head.held_on;
      lines.push('', weekdayDayMonth(day));
    }
    const parts = [hhmm(head.starts_at)];
    if (head.moved) parts.push('перенесено');
    const what = tag(head);
    if (what) parts.push(what);
    const left = seats(head, people.some((p) => p.booked));
    if (left) parts.push(left);
    lines.push(parts.join(' · '));
    for (const p of people) lines.push(`   ${p.who}${p.booked ? ' — придёт' : ''}`);
  }

  lines.push('', `Записаться: ${origin}/account`);
  return lines.join('\n');
}
