import { query } from './db';
import { hhmm, money, plural, weekdayDayMonth } from './format';
import { siteOrigin } from './site';
import { isConfigured, send } from './telegram';

/**
 * Сообщения по событию: занятие отменили, деньги заявили, деньги зачли.
 *
 * Почему это отдельно от рассылок: рассылку зовёт расписание, а его у нас
 * пока нет надёжного. Событие зовёт человек, нажавший кнопку, — такое
 * сообщение уходит всегда и сразу.
 *
 * Ни одна из этих функций не имеет права сломать действие, внутри которого
 * её позвали: Варя отменила занятие, и если телеграм лежит, отмена всё
 * равно должна состояться. Поэтому всё в try и ничего не бросаем.
 */
async function tell(chatId: string, text: string): Promise<boolean> {
  try {
    return await send(Number(chatId), text);
  } catch (err) {
    console.error('notify: не отправилось', err);
    return false;
  }
}

type Change = 'cancelled' | 'moved' | 'restored';

type Row = { chat: string; who: string; held_on: string; at: string; title: string };

/**
 * Кого предупредить про занятие: взрослых, отвечающих за записанных. У
 * ребёнка опекунов может быть двое, и знать должны оба.
 */
async function bookedFamilies(sessionId: string): Promise<Row[]> {
  return query<Row>(
    `select distinct u.tg_chat_id::text as chat,
            coalesce(ch.name, pu.name, 'участник') as who,
            s.held_on::text, coalesce(s.starts_at, g.starts_at)::text as at, g.title
       from bookings b
       join studio_sessions s on s.id = b.session_id
       join studio_groups g on g.id = s.group_id
       join participants p on p.id = b.participant_id
       left join children ch on ch.id = p.child_id
       left join users pu on pu.id = p.user_id
       join users u
         on (p.user_id is not null and u.id = p.user_id)
         or (p.child_id is not null
             and exists (select 1 from guardians gg
                          where gg.child_id = p.child_id and gg.user_id = u.id))
      where b.session_id = $1 and b.status = 'booked' and u.tg_chat_id is not null
      order by who`,
    [sessionId]);
}

/**
 * Занятие отменили, перенесли или вернули. Пишем только записанным: тем,
 * кто не собирался, эта новость не нужна.
 */
export async function sessionChanged(sessionId: string, change: Change): Promise<number> {
  if (!isConfigured()) return 0;
  let sent = 0;
  for (const m of await composeSessionChanged(sessionId, change, await siteOrigin())) {
    if (await tell(m.chat, m.text)) sent++;
  }
  console.log(`notify: занятие ${change}, отправлено ${sent}`);
  return sent;
}

export type Letter = { chat: string; text: string };

/**
 * Сборка текста отдельно от отправки: так его можно посмотреть, не
 * рассылая, а адрес сайта приходит аргументом — siteOrigin работает
 * только внутри запроса.
 */
export async function composeSessionChanged(
  sessionId: string, change: Change, origin: string,
): Promise<Letter[]> {
  const rows = await bookedFamilies(sessionId);
  if (rows.length === 0) return [];

  const byChat = new Map<string, Row[]>();
  for (const r of rows) byChat.set(r.chat, [...(byChat.get(r.chat) ?? []), r]);

  const head = rows[0];
  const when = `${weekdayDayMonth(head.held_on)}, ${hhmm(head.at)}`;
  const out: Letter[] = [];

  for (const [chat, mine] of byChat) {
    const names = [...new Set(mine.map((r) => r.who))].join(', ');
    const lines = change === 'cancelled'
      ? [`Занятие отменили: ${when}, ${head.title}.`, '',
         `Записаны были: ${names}.`, '',
         `Другие дни: ${origin}/account`]
      : change === 'moved'
        ? [`Занятие перенесли: теперь ${when}, ${head.title}.`, '',
           `Записаны: ${names}.`]
        : [`Занятие вернули в расписание: ${when}, ${head.title}.`, '',
           `Записаны: ${names}.`];
    out.push({ chat, text: lines.join('\n') });
  }
  return out;
}

/** Кому из студии идут служебные сообщения про деньги. */
async function moneyStaff(): Promise<{ chat: string }[]> {
  return query<{ chat: string }>(
    `select distinct u.tg_chat_id::text as chat
       from users u join user_roles r on r.user_id = u.id
      where r.role = 'admin' and u.tg_chat_id is not null`);
}

type Claim = { who: string; chat: string | null; amount: string; currency: string; ids: number };

async function claimById(paymentId: string): Promise<Claim | null> {
  return (await query<Claim>(
    `select coalesce(u.name, u.email) as who, u.tg_chat_id::text as chat,
            p.amount::text, p.currency,
            coalesce(jsonb_array_length(p.raw -> 'charge_ids'), 0) as ids
       from payments p join users u on u.id = p.user_id
      where p.id = $1`,
    [paymentId]))[0] ?? null;
}

/** Свежая неподтверждённая заявка этого родителя. */
async function claimPending(userId: string): Promise<Claim | null> {
  return (await query<Claim>(
    `select coalesce(u.name, u.email) as who, u.tg_chat_id::text as chat,
            p.amount::text, p.currency,
            coalesce(jsonb_array_length(p.raw -> 'charge_ids'), 0) as ids
       from payments p join users u on u.id = p.user_id
      where p.user_id = $1 and p.provider = 'cash' and p.status = 'pending'
        and p.purpose = 'studio_debt'
      order by p.created_at desc limit 1`,
    [userId]))[0] ?? null;
}

function lessons(n: number): string {
  return `${n} ${plural(n, 'занятие', 'занятия', 'занятий')}`;
}

/**
 * Родитель заявил, что заплатил наличными или переводом. Пока Варя не
 * подтвердит, деньги висят незачтёнными, а узнать об этом можно только
 * открыв «Финансы».
 *
 * Сумму берём из самой заявки, а не из аргументов: расходиться с тем, что
 * Варя увидит в «Финансах», это сообщение не должно.
 */
export async function composeCashDeclared(userId: string, origin: string): Promise<string | null> {
  const c = await claimPending(userId);
  if (!c) return null;
  return [
    `${c.who} заявил оплату: ${money(c.amount, c.currency)} за ${lessons(c.ids)}.`,
    '',
    `Подтвердить: ${origin}/admin/studio/debts`,
  ].join('\n');
}

export async function cashDeclared(userId: string): Promise<void> {
  if (!isConfigured()) return;
  const text = await composeCashDeclared(userId, await siteOrigin());
  if (!text) return;
  for (const s of await moneyStaff()) await tell(s.chat, text);
}

/** Деньги зачли. Родитель об этом иначе не узнаёт вовсе. */
export async function composeCashConfirmed(paymentId: string): Promise<Letter | null> {
  const c = await claimById(paymentId);
  if (!c?.chat) return null;
  return {
    chat: c.chat,
    text: `Оплату получили и зачли: ${money(c.amount, c.currency)} за ${lessons(c.ids)}.`,
  };
}

export async function cashConfirmed(paymentId: string): Promise<void> {
  if (!isConfigured()) return;
  const letter = await composeCashConfirmed(paymentId);
  if (letter) await tell(letter.chat, letter.text);
}

/**
 * Заявку не подтвердили. Молчать тут нельзя: родитель считает, что
 * заплатил, а занятия остаются в долгах.
 */
export async function composeCashDeclined(
  paymentId: string, origin: string, why?: string,
): Promise<Letter | null> {
  const c = await claimById(paymentId);
  if (!c?.chat) return null;
  return {
    chat: c.chat,
    text: [
      `Заявку на оплату ${money(c.amount, c.currency)} не подтвердили${why ? `: ${why}` : '.'}`,
      '',
      `Занятия остались неоплаченными: ${origin}/account/pay`,
    ].join('\n'),
  };
}

export async function cashDeclined(paymentId: string, why?: string): Promise<void> {
  if (!isConfigured()) return;
  const letter = await composeCashDeclined(paymentId, await siteOrigin(), why);
  if (letter) await tell(letter.chat, letter.text);
}
