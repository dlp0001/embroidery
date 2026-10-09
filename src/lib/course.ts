import { createHash, randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';
import { MAX_DEVICES } from './course-limits';
import { one, query, tx } from './db';
import { dayMonth } from './format';
import { siteOrigin } from './site';

/**
 * Видеокурс без регистрации. Покупатель не заводится в users: у него
 * своя строка в course_access, и вход в курс — по личной ссылке из письма.
 * Ссылка запоминает браузер (course_devices), дальше курс открывается сам.
 *
 * Студия этих таблиц не читает и не пишет, курс не трогает студийные.
 * Так покупатель курса не всплывает ни в «Людях», ни в журнале, ни в
 * рассылках, а родитель студии, купивший курс, остаётся обычным родителем.
 */

const BUNNY_LIBRARY = '675652';
/** Сколько живёт подписанная ссылка на плеер. Страница дольше не висит. */
const PLAYER_HOURS = 4;
/** Не чаще одного письма со ссылкой за это время, чтобы форму не превратили в спам. */
const LINK_PAUSE_MIN = 2;
/** last_seen обновляем не на каждый заход: хватает точности до часа. */
const SEEN_EVERY = '1 hour';

function hash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function secret(): string {
  return randomBytes(24).toString('base64url');
}

/** У каждого курса своя кука: доступ к вышивке не открывает вязание. */
function cookieName(slug: string): string {
  return `rc_course_${slug}`;
}

/** "2027-04-09" → "9 апреля 2027". */
export function longDate(iso: string): string {
  return `${dayMonth(iso)} ${iso.slice(0, 4)}`;
}

/** anna@gmail.com → a•••@gmail.com: чтобы человек узнал свою почту, а чужой не прочитал. */
export function maskEmail(email: string): string {
  const [name, domain] = email.split('@');
  return `${name.slice(0, 1)}•••@${domain}`;
}

// ── Курс и уроки ──────────────────────────────────────────

export type Course = { id: string; slug: string; title: string; access_months: number };

export async function courseBySlug(slug: string): Promise<Course | null> {
  return one<Course>(
    `select id, slug, title, access_months from courses
      where slug = $1 and status = 'published'`,
    [slug],
  );
}

export type Lesson = {
  position: number;
  slug: string;
  title: string;
  description: string | null;
  embed: string | null;
};

/**
 * Ссылка на плеер Bunny с подписью. В библиотеке включена проверка
 * токена: без подписи или с поддельной плеер отвечает 403. Поэтому
 * подписывать можно только после проверки доступа и только на сервере.
 */
export function bunnyEmbed(videoId: string): string {
  const expires = Math.floor(Date.now() / 1000) + PLAYER_HOURS * 60 * 60;
  const token = createHash('sha256')
    .update(`${process.env.BUNNY_TOKEN_KEY ?? ''}${videoId}${expires}`)
    .digest('hex');
  return (
    `https://player.mediadelivery.net/embed/${BUNNY_LIBRARY}/${videoId}` +
    `?token=${token}&expires=${expires}&autoplay=false&loop=false&muted=false&preload=false&responsive=true`
  );
}

/** Уроки с подписанным плеером. Звать только после проверки доступа. */
export async function lessonsWithPlayers(courseId: string): Promise<Lesson[]> {
  const rows = await query<{
    position: number; slug: string; title: string; description: string | null; video: string | null;
  }>(
    `select position, slug, title, description, bunny_video_id as video
       from lessons where course_id = $1 order by position`,
    [courseId],
  );
  return rows.map((r) => ({
    position: r.position,
    slug: r.slug,
    title: r.title,
    description: r.description,
    embed: r.video ? bunnyEmbed(r.video) : null,
  }));
}

// ── Доступ этого браузера ─────────────────────────────────

export type Access = {
  id: string;
  email: string;
  name: string | null;
  /** Последний день доступа, YYYY-MM-DD по времени студии. */
  until: string;
  expired: boolean;
};

/**
 * Доступ, который этот браузер получил по ссылке. null — браузер курсу
 * незнаком: ссылку здесь не открывали, устройство вытеснили или доступ
 * отозвали. Истёкший доступ возвращается с expired, чтобы показать дату.
 */
export async function deviceAccess(course: Course): Promise<Access | null> {
  const token = (await cookies()).get(cookieName(course.slug))?.value;
  if (!token) return null;
  const row = await one<Access & { device_id: string; stale: boolean }>(
    `select a.id, a.email, a.name,
            a.expires_at::date::text as until,
            a.expires_at <= now() as expired,
            d.id as device_id,
            d.last_seen < now() - interval '${SEEN_EVERY}' as stale
       from course_devices d
       join course_access a on a.id = d.access_id
      where d.token_hash = $1 and a.course_id = $2
        and d.revoked_at is null and a.revoked_at is null`,
    [hash(token), course.id],
  );
  if (!row) return null;
  if (row.stale) {
    await query('update course_devices set last_seen = now() where id = $1', [row.device_id]);
  }
  return { id: row.id, email: row.email, name: row.name, until: row.until, expired: row.expired };
}

// ── Ссылка из письма ──────────────────────────────────────

export type LinkInfo = {
  accessId: string;
  slug: string;
  title: string;
  email: string;
  until: string;
  expired: boolean;
};

/** Что за ссылка. null — такой нет: её заменили новой или её не было. */
export async function linkInfo(token: string): Promise<LinkInfo | null> {
  const row = await one<{
    id: string; slug: string; title: string; email: string; until: string; expired: boolean;
  }>(
    `select a.id, c.slug, c.title, a.email,
            a.expires_at::date::text as until,
            a.expires_at <= now() as expired
       from course_access a
       join courses c on c.id = a.course_id
      where a.link_hash = $1 and a.revoked_at is null`,
    [hash(token)],
  );
  return row
    ? { accessId: row.id, slug: row.slug, title: row.title, email: row.email, until: row.until, expired: row.expired }
    : null;
}

export type Redeem =
  | { ok: true; slug: string }
  | { ok: false; reason: 'unknown' | 'expired' | 'full' };

/**
 * Открыть курс по ссылке в этом браузере: завести устройство и положить
 * его ключ в куку.
 *
 * Устройств не больше трёх. Если все заняты, ссылка, которую ещё ни разу
 * не открывали, вытесняет самое давнее: она только что пришла на почту
 * покупателя, значит, это он сам. Уже открытая ссылка места не получает —
 * так пересланная подруге ссылка упирается в лимит, а покупатель всегда
 * может запросить свежую на свою почту.
 */
export async function redeemLink(token: string, userAgent: string | null): Promise<Redeem> {
  const info = await linkInfo(token);
  if (!info) return { ok: false, reason: 'unknown' };
  if (info.expired) return { ok: false, reason: 'expired' };

  // Этот браузер уже открывал курс по этому доступу — второе устройство
  // из него не заводим, иначе каждое нажатие съедало бы место.
  const store = await cookies();
  const known = store.get(cookieName(info.slug))?.value;
  if (known) {
    const same = await one(
      `select 1 from course_devices
        where token_hash = $1 and access_id = $2 and revoked_at is null`,
      [hash(known), info.accessId],
    );
    if (same) return { ok: true, slug: info.slug };
  }

  const device = secret();
  const result = await tx(async (c) => {
    const a = (await c.query<{ link_used_at: Date | null; expires_at: Date }>(
      `select link_used_at, expires_at from course_access
        where id = $1 and link_hash = $2 and revoked_at is null
        for update`,
      [info.accessId, hash(token)],
    )).rows[0];
    if (!a) return { ok: false as const, reason: 'unknown' as const };

    const active = (await c.query<{ id: string }>(
      `select id from course_devices
        where access_id = $1 and revoked_at is null
        order by last_seen`,
      [info.accessId],
    )).rows;
    if (active.length >= MAX_DEVICES) {
      if (a.link_used_at) return { ok: false as const, reason: 'full' as const };
      const evict = active.slice(0, active.length - MAX_DEVICES + 1).map((r) => r.id);
      await c.query('update course_devices set revoked_at = now() where id = any($1)', [evict]);
    }

    await c.query(
      `insert into course_devices (access_id, token_hash, user_agent) values ($1, $2, $3)`,
      [info.accessId, hash(device), userAgent?.slice(0, 300) ?? null],
    );
    await c.query(
      'update course_access set link_used_at = coalesce(link_used_at, now()) where id = $1',
      [info.accessId],
    );
    return { ok: true as const, expires: a.expires_at };
  });
  if (!result.ok) return result;

  store.set(cookieName(info.slug), device, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/learn',
    expires: result.expires,
  });
  return { ok: true, slug: info.slug };
}

// ── Выдача доступа ────────────────────────────────────────

export type Order = {
  provider: string;
  providerId: string;
  amount: number | null;
  currency: string | null;
  /** Начатая оплата из course_checkouts, если покупали через форму. */
  checkoutId?: string | null;
  raw?: unknown;
};

export type Grant = { accessId: string; duplicate: boolean };

class DuplicateOrder extends Error {}

/**
 * Открыть курс по почте: после оплаты, вручную или при переносе старых
 * покупателей. Повторная покупка продлевает срок от сегодняшнего дня или
 * от нынешнего конца, что позже, — купивший заранее ничего не теряет.
 *
 * С оплатой: если этот платёж уже записан (провайдер прислал вебхук
 * второй раз), ничего не меняем и отвечаем duplicate.
 */
export async function grantAccess(input: {
  slug: string;
  email: string;
  name?: string | null;
  source: 'purchase' | 'manual' | 'legacy';
  order?: Order;
}): Promise<Grant> {
  const email = input.email.trim().toLowerCase();
  try {
    return await tx(async (c) => {
      const course = (await c.query<{ id: string; access_months: number }>(
        `select id, access_months from courses where slug = $1`,
        [input.slug],
      )).rows[0];
      if (!course) throw new Error(`курс ${input.slug} не найден`);

      const access = (await c.query<{ id: string }>(
        `insert into course_access (course_id, email, name, source, expires_at)
         values ($1, $2, $3, $4, now() + make_interval(months => $5))
         on conflict (course_id, email) do update
           set expires_at = greatest(course_access.expires_at, now()) + make_interval(months => $5),
               revoked_at = null,
               name = coalesce(course_access.name, excluded.name)
         returning id`,
        [course.id, email, input.name?.trim() || null, input.source, course.access_months],
      )).rows[0];

      if (input.order) {
        const o = input.order;
        const saved = await c.query(
          `insert into course_orders (access_id, provider, provider_id, amount, currency, checkout_id, raw)
           values ($1, $2, $3, $4, $5, $6, $7)
           on conflict (provider, provider_id) do nothing
           returning id`,
          [access.id, o.provider, o.providerId, o.amount, o.currency, o.checkoutId ?? null,
           o.raw === undefined ? null : JSON.stringify(o.raw)],
        );
        // Откатываем продление: этот платёж уже продлевал доступ.
        if (saved.rowCount === 0) throw new DuplicateOrder();
      }
      return { accessId: access.id, duplicate: false };
    });
  } catch (err) {
    if (!(err instanceof DuplicateOrder)) throw err;
    const row = await one<{ id: string }>(
      `select a.id from course_access a join courses c on c.id = a.course_id
        where c.slug = $1 and a.email = $2`,
      [input.slug, email],
    );
    return { accessId: row!.id, duplicate: true };
  }
}

// ── Письмо со ссылкой ─────────────────────────────────────

/**
 * Новая ссылка взамен прежней и письмо с ней. Прежняя ссылка перестаёт
 * работать, уже открытые по ней браузеры остаются.
 *
 * false — письмо не ушло. Тогда старая ссылка уже заменена, и человеку
 * нужно сказать об этом, а не делать вид, что всё отправлено.
 *
 * moved — письмо покупателям первого потока: курс у них уже был, поэтому
 * не «открыт», а «переехал».
 */
export async function sendLink(accessId: string, kind: 'access' | 'moved' = 'access'): Promise<boolean> {
  const token = secret();
  const row = await one<{ email: string; name: string | null; title: string; until: string }>(
    `update course_access a
        set link_hash = $2, link_sent_at = now(), link_used_at = null
       from courses c
      where a.id = $1 and c.id = a.course_id
      returning a.email, a.name, c.title, a.expires_at::date::text as until`,
    [accessId, hash(token)],
  );
  if (!row) return false;
  const url = `${await siteOrigin()}/learn/k/${token}`;
  const subject = kind === 'moved'
    ? `Записи курса «${row.title}» переехали`
    : `Доступ к курсу «${row.title}»`;
  return sendMail(row.email, subject, linkLetter({ ...row, url, kind }));
}

/**
 * Свежая ссылка по просьбе со страницы курса. Ничего не сообщает о том,
 * есть ли такая почта среди покупателей: ответ на странице один и тот же.
 */
export async function requestLink(slug: string, rawEmail: string): Promise<boolean> {
  const email = rawEmail.trim().toLowerCase();
  const row = await one<{ id: string }>(
    `select a.id from course_access a
       join courses c on c.id = a.course_id
      where c.slug = $1 and a.email = $2
        and a.revoked_at is null and a.expires_at > now()
        and (a.link_sent_at is null
             or a.link_sent_at < now() - interval '${LINK_PAUSE_MIN} minutes')`,
    [slug, email],
  );
  if (!row) return true;
  return sendLink(row.id);
}

async function sendMail(to: string, subject: string, html: string): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    if (process.env.NODE_ENV === 'production') {
      console.error('course: RESEND_API_KEY не задан, письмо не отправлено');
      return false;
    }
    // В разработке письма не уходят: ссылку видно в консоли.
    const link = html.match(/href="([^"]+\/learn\/k\/[^"]+)"/)?.[1];
    console.log(`\n  Письмо для ${to}: ${subject}\n  ${link ?? ''}\n`);
    return true;
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: process.env.FROM_EMAIL ?? 'info@re-create.art',
        to,
        subject,
        html,
      }),
    });
    if (!res.ok) {
      console.error('course: resend', res.status, await res.text());
      return false;
    }
    return true;
  } catch (err) {
    console.error('course: письмо не ушло', err);
    return false;
  }
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!);
}

function linkLetter(p: {
  name: string | null; title: string; until: string; url: string; kind: 'access' | 'moved';
}): string {
  const hello = p.name ? `Привет, ${esc(p.name)}!` : 'Привет!';
  const intro = p.kind === 'moved'
    ? `Записи уроков курса «${esc(p.title)}» и список материалов переехали на новую страницу. Старый адрес re-create.art/video скоро перестанет работать, поэтому сохраните это письмо: кнопка ниже — ваш личный вход.`
    : `Курс «${esc(p.title)}» открыт: четыре урока и полный список материалов с ссылками, где их купить.`;
  return `
  <div style="font-family:Georgia,'Times New Roman',serif;max-width:560px;margin:0 auto;color:#1a1a2e;background:#ffffff;">
    <div style="background:#1a1a2e;padding:32px 48px;text-align:center;">
      <div style="font-size:11px;letter-spacing:0.3em;text-transform:uppercase;color:#e91e8c;margin-bottom:8px;font-family:sans-serif;">Re.Create.Art</div>
      <div style="font-size:20px;font-weight:300;color:#ffffff;letter-spacing:0.05em;">Варя Перлина</div>
    </div>
    <div style="padding:40px 48px 28px;">
      <p style="font-size:24px;font-weight:300;margin:0 0 24px;line-height:1.3;">${hello}</p>
      <p style="font-size:15px;color:#444;line-height:1.85;margin:0 0 24px;">${intro}</p>
      <p style="margin:0 0 28px;">
        <a href="${p.url}" style="display:inline-block;background:#e91e8c;color:#ffffff;text-decoration:none;font-family:sans-serif;font-size:13px;letter-spacing:0.15em;text-transform:uppercase;padding:16px 36px;">Открыть курс</a>
      </p>
      <p style="font-size:14px;color:#666;line-height:1.8;margin:0 0 14px;">Доступ открыт до ${longDate(p.until)}.</p>
      <p style="font-size:14px;color:#666;line-height:1.8;margin:0 0 32px;">Ссылка личная: она запоминает браузер, в котором её открыли, и дальше курс открывается без входа. Можно смотреть на ${MAX_DEVICES} устройствах — например, на телефоне, планшете и компьютере. Для нового устройства запросите свежую ссылку на странице курса.</p>
      <div style="border-top:1px solid #f0e0e8;padding-top:24px;">
        <div style="font-size:17px;font-weight:300;margin-bottom:4px;">Варя Перлина</div>
        <div style="font-size:11px;color:#999;letter-spacing:0.1em;font-family:sans-serif;">re-create.art</div>
      </div>
    </div>
    <div style="background:#f5f0fa;padding:18px 48px;text-align:center;">
      <p style="font-size:11px;color:#aaa;margin:0;line-height:1.7;font-family:sans-serif;">
        Если кнопка не открывается, скопируйте адрес: ${p.url}<br>
        Вопросы: <a href="mailto:info@re-create.art" style="color:#e91e8c;text-decoration:none;">info@re-create.art</a>
      </p>
    </div>
  </div>`;
}
