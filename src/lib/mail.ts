import { createHmac, timingSafeEqual } from 'node:crypto';
import { one, query } from './db';

/**
 * Отказ от общих писем. Ссылка в письме подписана: иначе по чужому адресу
 * можно было бы отписать кого угодно, просто подставив его в строку.
 *
 * Та же подпись считается в scripts/mail-blast.mjs — если меняете здесь,
 * поменяйте и там, иначе старые письма перестанут отписывать.
 */
export function unsubToken(email: string): string {
  const secret = process.env.SESSION_SECRET ?? '';
  return createHmac('sha256', secret).update(`unsub:${email.toLowerCase()}`).digest('hex').slice(0, 32);
}

export function tokenOk(email: string, token: string): boolean {
  const expected = Buffer.from(unsubToken(email));
  const given = Buffer.from(token);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/**
 * Выводит адрес из рассылки. Письма про занятия и деньги самого человека
 * это не отменяет: код входа и квитанции приходят всегда.
 */
export async function optOut(email: string): Promise<void> {
  await query('update users set mail_optout_at = now() where email = $1 and mail_optout_at is null',
    [email.trim().toLowerCase()]);
}

/**
 * Возврат в рассылку. Нужен, потому что отписаться можно нечаянно: в Gmail
 * своя кнопка «Отписаться» сверху письма, и она срабатывает без вопросов.
 * Ссылка из того же письма приводит сюда и позволяет передумать.
 */
export async function optIn(email: string): Promise<void> {
  await query('update users set mail_optout_at = null where email = $1',
    [email.trim().toLowerCase()]);
}

/** Уже не в рассылке? Чтобы не предлагать отписаться тому, кто отписан. */
export async function isOptedOut(email: string): Promise<boolean> {
  const row = await one<{ out: boolean }>(
    'select mail_optout_at is not null as out from users where email = $1',
    [email.trim().toLowerCase()]);
  return row?.out ?? false;
}
