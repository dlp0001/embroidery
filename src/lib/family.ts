// Второй родитель: приглашение по ссылке и метка «чеки на меня».
//
// Семьи как таблицы у нас нет и не нужно: семья — это общие дети.
// Родители одного ребёнка и есть семья, а опека уже «много ко многим».

import { createHash, randomBytes } from 'node:crypto';
import { one, query, tx } from './db';

const INVITE_TTL_DAYS = 7;

function hashToken(raw: string): string {
  const pepper = process.env.SESSION_SECRET ?? '';
  return createHash('sha256').update(`family:${raw}:${pepper}`).digest('hex');
}

export type CoParent = {
  id: string;
  name: string;
  email: string;
  /** Квитанции студия выписывает на него. */
  receipts: boolean;
};

/**
 * Остальные родители тех же детей. Пусто — семья пока из одного
 * взрослого, и приглашать второго как раз и предлагаем.
 */
export async function coParents(userId: string): Promise<CoParent[]> {
  return query<CoParent>(
    `select distinct u.id, coalesce(u.name, u.email) as name, u.email::text, u.receipts
       from guardians mine
       join guardians theirs on theirs.child_id = mine.child_id
       join users u on u.id = theirs.user_id
      where mine.user_id = $1 and theirs.user_id <> $1
      order by name`,
    [userId],
  );
}

/**
 * Все, на кого в этой семье записаны деньги. Начисление принадлежит
 * одному плательщику (журнал выбирает того, у кого есть абонемент), но
 * долг у семьи общий: видеть и закрывать его вправе любой из родителей.
 */
export async function familyOwners(userId: string): Promise<string[]> {
  const rows = await query<{ id: string }>(
    `select distinct theirs.user_id as id
       from guardians mine
       join guardians theirs on theirs.child_id = mine.child_id
      where mine.user_id = $1 and theirs.user_id <> $1`,
    [userId],
  );
  return [userId, ...rows.map((r) => r.id)];
}

/**
 * Кому в этой семье выписывать квитанцию. Метку держит кто-то один;
 * если её нет ни у кого — бумага идёт плательщику, как было до второго
 * родителя.
 */
export async function billTo(userId: string): Promise<string> {
  const row = await one<{ id: string }>(
    `select u.id from guardians mine
       join guardians theirs on theirs.child_id = mine.child_id
       join users u on u.id = theirs.user_id
      where mine.user_id = $1 and u.receipts
      /* Метку держит кто-то один, но админ вправе связать семью руками.
         Тогда берём того, кто регистрировался раньше. */
      order by u.created_at, u.id
      limit 1`,
    [userId],
  );
  return row?.id ?? userId;
}

/**
 * Передать метку. Переходящая она потому, что иначе появляются
 * состояния «у обоих» и «ни у кого», и непонятно, чьё имя в отчётности.
 */
export async function takeReceipts(userId: string, targetId: string): Promise<void> {
  const family = await familyOwners(userId);
  if (!family.includes(targetId)) throw new Error('FORBIDDEN');
  await tx(async (c) => {
    await c.query('update users set receipts = false where id = any($1::uuid[])', [family]);
    await c.query('update users set receipts = true where id = $1', [targetId]);
  });
}

/**
 * Ссылка-приглашение, одноразовая и на неделю.
 *
 * Прежние неиспользованные гасим: в базе лежит только хеш, показать ту
 * же ссылку второй раз мы не можем, а живых ссылок в одну семью не
 * должно оставаться больше одной.
 */
export async function inviteUrl(userId: string, origin: string): Promise<string> {
  const raw = randomBytes(24).toString('base64url');
  await tx(async (c) => {
    await c.query('delete from family_invites where inviter_id = $1 and used_at is null', [userId]);
    await c.query(
      `insert into family_invites (inviter_id, token_hash, expires_at)
       values ($1, $2, now() + ($3 || ' days')::interval)`,
      [userId, hashToken(raw), String(INVITE_TTL_DAYS)],
    );
  });
  return `${origin}/join/${raw}`;
}

export type Invite = {
  inviter_id: string;
  /** Кто приглашает — его и увидит второй родитель. */
  inviter: string;
  /** Имена детей: по ним человек поймёт, туда ли он попал. */
  children: string[];
};

/** Что показать на странице приглашения. Null — ссылка не годится. */
export async function inviteLook(raw: string): Promise<Invite | null> {
  return one<Invite>(
    `select i.inviter_id,
            coalesce(u.name, u.email) as inviter,
            coalesce((select array_agg(ch.name order by ch.name)
                        from guardians g join children ch on ch.id = g.child_id
                       where g.user_id = i.inviter_id and ch.archived_at is null),
                     '{}') as children
       from family_invites i
       join users u on u.id = i.inviter_id
      where i.token_hash = $1 and i.used_at is null and i.expires_at > now()`,
    [hashToken(raw)],
  );
}

export type Accepted = { ok: true; children: number } | { ok: false; error: string };

/**
 * Принять приглашение: вписать второго родителя опекуном ко всем детям
 * пригласившего. Скрытых детей тоже: их занятия и оплаты сохранены, и
 * прошлое второму родителю видеть не вредно.
 */
export async function acceptInvite(raw: string, userId: string, name?: string): Promise<Accepted> {
  return tx<Accepted>(async (c) => {
    const { rows } = await c.query<{ id: string; inviter_id: string }>(
      `select id, inviter_id from family_invites
        where token_hash = $1 and used_at is null and expires_at > now()
        for update`,
      [hashToken(raw)],
    );
    const invite = rows[0];
    if (!invite) return { ok: false, error: 'Ссылка устарела или уже использована.' };
    if (invite.inviter_id === userId) {
      return { ok: false, error: 'Это ваша же ссылка: отправьте её второму родителю.' };
    }

    const { rowCount } = await c.query(
      `insert into guardians (child_id, user_id)
       select g.child_id, $2 from guardians g where g.user_id = $1
       on conflict do nothing`,
      [invite.inviter_id, userId],
    );
    // Метка квитанций остаётся у того, кто регистрировался первым.
    await c.query('update users set receipts = false where id = $1', [userId]);
    const { rows: held } = await c.query<{ yes: boolean }>(
      `select exists (
         select 1 from guardians g join users u on u.id = g.user_id
          where g.child_id in (select child_id from guardians where user_id = $1)
            and u.receipts) as yes`,
      [invite.inviter_id],
    );
    if (!held[0]?.yes) {
      await c.query('update users set receipts = true where id = $1', [invite.inviter_id]);
    }
    if (name && name.trim()) {
      await c.query('update users set name = $2 where id = $1', [userId, name.trim()]);
    }
    await c.query(
      `insert into user_roles (user_id, role) values ($1, 'parent') on conflict do nothing`,
      [userId],
    );
    await c.query(
      'update family_invites set used_at = now(), used_by = $2 where id = $1',
      [invite.id, userId],
    );
    return { ok: true, children: rowCount ?? 0 };
  });
}
