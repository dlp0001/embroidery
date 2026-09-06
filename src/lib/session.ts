import { createHash, randomBytes } from 'node:crypto';
import { cache } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { one, query } from './db';

const COOKIE = 'rc_session';
const DAYS = 30;

export type Role = 'parent' | 'student' | 'teacher' | 'admin' | 'superadmin';

export type CurrentUser = {
  id: string;
  email: string;
  name: string | null;
  roles: Role[];
};

function hash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function createSession(userId: string): Promise<void> {
  const token = randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + DAYS * 24 * 60 * 60 * 1000);
  await query('insert into sessions (user_id, token_hash, expires_at) values ($1, $2, $3)', [
    userId,
    hash(token),
    expires,
  ]);
  const store = await cookies();
  store.set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    expires,
  });
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  const token = store.get(COOKIE)?.value;
  if (token) await query('delete from sessions where token_hash = $1', [hash(token)]);
  store.delete(COOKIE);
}

/**
 * Обёрнуто в cache: layout и страница спрашивают пользователя каждый по
 * разу, а до базы за один рендер ходим один раз. При латентности до Neon
 * это не мелочь: лишний поход стоит дороже, чем весь запрос.
 */
export const currentUser = cache(async (): Promise<CurrentUser | null> => {
  const store = await cookies();
  const token = store.get(COOKIE)?.value;
  if (!token) return null;

  const row = await one<{ id: string; email: string; name: string | null; roles: Role[] | null }>(
    `select u.id, u.email, u.name,
            array_remove(array_agg(r.role), null) as roles
       from sessions s
       join users u on u.id = s.user_id
       left join user_roles r on r.user_id = u.id
      where s.token_hash = $1 and s.expires_at > now()
      group by u.id`,
    [hash(token)],
  );
  if (!row) return null;
  return { id: row.id, email: row.email, name: row.name, roles: row.roles ?? [] };
});

/**
 * Страница и layout рендерятся параллельно, поэтому проверка в layout
 * не мешает странице выполниться с пустым пользователем. Каждая страница
 * зовёт это сама.
 */
export async function requireUser(): Promise<CurrentUser> {
  const user = await currentUser();
  if (!user) redirect('/login');
  return user;
}

export async function requireTeacher(): Promise<CurrentUser> {
  const user = await requireUser();
  if (!canTeach(user)) redirect('/account');
  return user;
}

export function canTeach(user: CurrentUser): boolean {
  return user.roles.some((r) => r === 'teacher' || r === 'admin' || r === 'superadmin');
}

export function isAdmin(user: CurrentUser): boolean {
  return user.roles.some((r) => r === 'admin' || r === 'superadmin');
}

/** Только суперадмин трогает уже проведённые деньги. */
export function isSuperadmin(user: CurrentUser): boolean {
  return user.roles.includes('superadmin');
}
