import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import { one, query } from './db';
import { createSession } from './session';

const CODE_TTL_MIN = 10;
const MAX_ATTEMPTS = 5;
const MAX_CODES_PER_15MIN = 3;

function hashCode(email: string, code: string): string {
  const pepper = process.env.SESSION_SECRET ?? '';
  return createHash('sha256').update(`${email.toLowerCase()}:${code}:${pepper}`).digest('hex');
}

export type RequestCodeResult = { ok: true; devCode?: string } | { ok: false; error: string };

export async function requestCode(rawEmail: string): Promise<RequestCodeResult> {
  const email = rawEmail.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return { ok: false, error: 'Проверьте адрес почты' };
  }

  let recent: { n: string } | null;
  try {
    recent = await one<{ n: string }>(
    `select count(*)::text as n from login_codes
      where email = $1 and created_at > now() - interval '15 minutes'`,
      [email],
    );
  } catch (err) {
    console.error('login: база недоступна', err);
    return { ok: false, error: 'Не удаётся связаться с базой. Попробуйте позже.' };
  }
  if (Number(recent?.n ?? 0) >= MAX_CODES_PER_15MIN) {
    return { ok: false, error: 'Слишком много запросов. Попробуйте через несколько минут.' };
  }

  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  try {
    await query(
    `insert into login_codes (email, code_hash, expires_at)
     values ($1, $2, now() + ($3 || ' minutes')::interval)`,
      [email, hashCode(email, code), String(CODE_TTL_MIN)],
    );
  } catch (err) {
    console.error('login: не удалось записать код', err);
    return { ok: false, error: 'Не удаётся связаться с базой. Попробуйте позже.' };
  }

  await sendCode(email, code);
  // В разработке письма не уходят, поэтому код показываем на странице.
  const dev = process.env.NODE_ENV !== 'production' && !process.env.RESEND_API_KEY;
  return dev ? { ok: true, devCode: code } : { ok: true };
}

async function sendCode(email: string, code: string): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    // Без ключа письма не уходят: код видно в консоли сервера.
    console.log(`\n  Код входа для ${email}: ${code}\n`);
    return;
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: process.env.FROM_EMAIL ?? 'info@re-create.art',
      to: email,
      subject: `${code} — код входа в Re.Create.Art`,
      html: `<div style="font-family:Georgia,serif;max-width:420px;margin:0 auto;padding:32px;color:#1a1a2e">
        <p style="font-size:11px;letter-spacing:.3em;text-transform:uppercase;color:#666;margin:0 0 24px">Re.Create.Art</p>
        <p style="font-size:16px;margin:0 0 20px">Код для входа:</p>
        <p style="font-family:'Jost',sans-serif;font-size:38px;letter-spacing:.2em;color:#e91e8c;margin:0 0 20px">${code}</p>
        <p style="font-size:14px;color:#666;line-height:1.7;margin:0">Действует ${CODE_TTL_MIN} минут. Если вы не запрашивали вход, просто удалите это письмо.</p>
      </div>`,
    }),
  });
  if (!res.ok) console.error('resend:', res.status, await res.text());
}

export type VerifyResult = { ok: true } | { ok: false; error: string };

export async function verifyCode(rawEmail: string, rawCode: string): Promise<VerifyResult> {
  const email = rawEmail.trim().toLowerCase();
  const code = rawCode.replace(/\D/g, '');
  if (code.length !== 6) return { ok: false, error: 'Код состоит из шести цифр' };

  const row = await one<{ id: string; code_hash: string; attempts: number }>(
    `select id, code_hash, attempts from login_codes
      where email = $1 and used_at is null and expires_at > now()
      order by created_at desc limit 1`,
    [email],
  );
  if (!row) return { ok: false, error: 'Код устарел. Запросите новый.' };
  if (row.attempts >= MAX_ATTEMPTS) {
    return { ok: false, error: 'Слишком много попыток. Запросите новый код.' };
  }

  const expected = Buffer.from(row.code_hash, 'hex');
  const given = Buffer.from(hashCode(email, code), 'hex');
  const match = expected.length === given.length && timingSafeEqual(expected, given);

  if (!match) {
    await query('update login_codes set attempts = attempts + 1 where id = $1', [row.id]);
    return { ok: false, error: 'Неверный код' };
  }

  await query('update login_codes set used_at = now() where id = $1', [row.id]);

  let user = await one<{ id: string }>('select id from users where email = $1', [email]);
  if (!user) {
    user = await one<{ id: string }>(
      'insert into users (email) values ($1) returning id',
      [email],
    );
    await query(
      `insert into user_roles (user_id, role) values ($1, 'parent') on conflict do nothing`,
      [user!.id],
    );
    await query(
      `insert into participants (user_id) values ($1) on conflict do nothing`,
      [user!.id],
    );
  }

  await createSession(user!.id);
  return { ok: true };
}
