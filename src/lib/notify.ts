import { query } from './db';
import { dayMonth, hhmm, money, plural, weekdayDayMonth } from './format';
import { siteOrigin } from './site';
import { isConfigured as receiptsReady } from './icount';
import {
  isConfigured, packId, send, PAY_LETTER, type Keyboard, type PayLetter, type View,
} from './telegram';

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
export async function sessionChanged(
  sessionId: string, change: Change, actor?: string | null,
): Promise<number> {
  if (!isConfigured()) return 0;
  const origin = await siteOrigin();
  let sent = 0;

  const family = await composeSessionChanged(sessionId, change, origin);
  for (const m of family) {
    if (await tell(m.chat, m.text)) sent++;
  }

  // Админам — своё сообщение: им нужен весь состав занятия, а не одна
  // семья. Того, кто нажал, не исключаем: пусть у обоих будет одна
  // картина происходящего. А вот дважды одному чату не пишем — админ
  // может оказаться и родителем записанного.
  const already = new Set(family.map((m) => m.chat));
  const staff = await composeStaffSessionChanged(sessionId, change, actor);
  if (staff) {
    for (const a of await adminChats()) {
      if (already.has(a.chat)) continue;
      if (await tell(a.chat, staff)) sent++;
    }
  }

  console.log(`notify: занятие ${change}, отправлено ${sent}`);
  return sent;
}

/**
 * То же событие для студии. Отличается составом: перечисляем всех
 * записанных, а не только чью-то семью, и называем, кто нажал, — иначе
 * своё действие не отличить от чужого.
 */
export async function composeStaffSessionChanged(
  sessionId: string, change: Change, actor?: string | null,
): Promise<string | null> {
  const head = (await query<{
    title: string; held_on: string; at: string; booked: number;
  }>(
    `select g.title, s.held_on::text, coalesce(s.starts_at, g.starts_at)::text as at,
            (select count(*)::int from bookings b
              where b.session_id = s.id and b.status = 'booked') as booked
       from studio_sessions s join studio_groups g on g.id = s.group_id
      where s.id = $1`,
    [sessionId]))[0];
  if (!head) return null;

  const names = (await query<{ who: string }>(
    `select coalesce(ch.name, u.name, 'участник') as who
       from bookings b
       join participants p on p.id = b.participant_id
       left join children ch on ch.id = p.child_id
       left join users u on u.id = p.user_id
      where b.session_id = $1 and b.status = 'booked'
      order by who`,
    [sessionId])).map((r) => r.who);

  const when = `${weekdayDayMonth(head.held_on)}, ${hhmm(head.at)}`;
  const what = change === 'cancelled' ? 'Занятие отменили'
    : change === 'moved' ? 'Занятие перенесли'
    : 'Занятие вернули в расписание';

  return [
    `${what}: ${when}, ${head.title}.`,
    '',
    names.length > 0 ? `Записаны: ${names.join(', ')}.` : 'Записанных не было.',
    ...(actor ? ['', `Кто нажал: ${actor}.`] : []),
  ].join('\n');
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

/** Админы, до которых бот может дотянуться: им идёт служебное. */
async function adminChats(): Promise<{ chat: string }[]> {
  return query<{ chat: string }>(
    `select distinct u.tg_chat_id::text as chat
       from users u join user_roles r on r.user_id = u.id
      where r.role = 'admin' and u.tg_chat_id is not null`);
}

export type Claim = {
  id: string; who: string; chat: string | null;
  amount: string; currency: string; ids: number;
  /** Что сказал сам родитель: от этого зависит, подставлять ли способ. */
  way: 'cash' | 'transfer' | null;
  status: string;
};

async function claimById(paymentId: string): Promise<Claim | null> {
  return (await query<Claim>(
    `select p.id, coalesce(u.name, u.email) as who, u.tg_chat_id::text as chat,
            p.amount::text, p.currency, p.status,
            coalesce(jsonb_array_length(p.raw -> 'charge_ids'), 0) as ids,
            (p.raw ->> 'declared_way') as way
       from payments p join users u on u.id = p.user_id
      where p.id = $1`,
    [paymentId]))[0] ?? null;
}

/** Свежая неподтверждённая заявка этого родителя. */
async function claimPending(userId: string): Promise<Claim | null> {
  return (await query<Claim>(
    `select p.id, coalesce(u.name, u.email) as who, u.tg_chat_id::text as chat,
            p.amount::text, p.currency, p.status,
            coalesce(jsonb_array_length(p.raw -> 'charge_ids'), 0) as ids,
            (p.raw ->> 'declared_way') as way
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
 * подтвердит, деньги висят незачтёнными, а узнать об этом можно было
 * только открыв «Финансы».
 *
 * Сумму берём из самой заявки: расходиться с тем, что Варя увидит на
 * экране, это сообщение не должно.
 */
export async function cashDeclared(userId: string): Promise<void> {
  if (!isConfigured()) return;
  const claim = await claimPending(userId);
  if (!claim) return;
  const card = claimCard(claim, null);
  for (const s of await adminChats()) {
    try {
      await send(Number(s.chat), card.text, card.keyboard);
    } catch (err) {
      console.error('notify: заявка не отправилась', err);
    }
  }
}

const WAY_NAME: Record<PayLetter, string> = {
  c: 'наличными', t: 'переводом', b: 'Bit', p: 'PayBox',
};

/** Как назвать способ в строке, а не на кнопке. */
const WAY_PLAIN: Record<PayLetter, string> = {
  c: 'наличные', t: 'перевод', b: 'Bit', p: 'PayBox',
};

/**
 * Карточка заявки с кнопками: подтвердить оплату можно прямо в боте.
 *
 * Два касания, а не одно, и это не лишний шаг. Способ обязателен: у
 * родителя «перевод» значит и банк, и биток, и пейбокс, а в чеке это три
 * разные вещи, поэтому ничего не подставляем — так же, как на экране
 * «Финансы». Наличные другое дело, их Варя берёт в руки, поэтому они
 * стоят первыми. Чек по умолчанию не выписывается, как и галочка на сайте.
 */
export function claimCard(claim: Claim, chosen: PayLetter | null): View {
  // Без глаголов в прошедшем времени: имя мы склонять не умеем, и
  // «Мария Дашевская заявил» читалось как небрежность.
  const head = `Заявка на оплату: ${claim.who}, ${money(claim.amount, claim.currency)} за ${
    lessons(claim.ids)}.`;
  const said = `Метод оплаты: ${
    claim.way === 'cash' ? 'наличные'
      : claim.way === 'transfer' ? 'перевод'
      : 'не указан'}`;
  const id = packId(claim.id);

  if (!chosen) {
    const letters: PayLetter[] = claim.way === 'transfer'
      ? ['t', 'b', 'p', 'c']
      : ['c', 't', 'b', 'p'];
    const keyboard: Keyboard = [];
    for (let i = 0; i < letters.length; i += 2) {
      keyboard.push(letters.slice(i, i + 2).map((l) => ({
        text: WAY_NAME[l], callback_data: `pm${l}:${id}`,
      })));
    }
    keyboard.push([{ text: 'Отклонить заявку', callback_data: `px:${id}` }]);
    return { text: [head, said, '', 'Подтверждаю оплату:'].join('\n'), keyboard };
  }

  // Чек — второй вопрос. Без iCount выписывать его некому, тогда и
  // выбора нет: просто подтверждаем.
  const keyboard: Keyboard = receiptsReady()
    ? [[{ text: 'Без чека', callback_data: `pc${chosen}0:${id}` },
        { text: 'С чеком', callback_data: `pc${chosen}1:${id}` }],
       [{ text: 'Назад', callback_data: `pb:${id}` }]]
    : [[{ text: 'Деньги получены', callback_data: `pc${chosen}0:${id}` }],
       [{ text: 'Назад', callback_data: `pb:${id}` }]];

  return {
    text: [head, `Засчитываем как: ${WAY_PLAIN[chosen]}`, '',
           receiptsReady() ? 'Выписать чек в iCount?' : 'iCount не подключён, чека не будет.',
    ].join('\n'),
    keyboard,
  };
}

/** Заявка по номеру платежа: нужна, чтобы перерисовать карточку. */
export async function claimOf(paymentId: string): Promise<Claim | null> {
  return claimById(paymentId);
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

// ── Записи на смену ───────────────────────────────────────

/** «27, 28 сентября» — месяц один раз, если он у всех общий. */
function daysList(days: string[]): string {
  const months = new Set(days.map((d) => d.slice(0, 7)));
  if (months.size > 1) return days.map(dayMonth).join(', ');
  const nums = days.map((d) => Number(d.slice(8)));
  const month = dayMonth(days[0]).split(' ')[1];
  return `${nums.join(', ')} ${month}`;
}

type CampChange = {
  who: string; title: string; day: string; status: string; total: number;
};

/**
 * Записи на лагерь и мастер-классы — сводкой, а не по одной.
 *
 * Родитель отмечает дни подряд, отдельными нажатиями: за полторы минуты
 * набирается десять. Сообщение на каждое превратило бы телефон в
 * барабан, поэтому собираем всё, что изменилось с прошлого раза, и
 * отправляем разом. Окно берём из `settings.camp_report_at`, а заодно им
 * же и занимаем: два тика подряд не отчитаются об одном и том же.
 *
 * Первый запуск ничего не шлёт, только ставит отметку: иначе в первый же
 * раз приехал бы весь архив смены.
 */
export async function campReport(): Promise<string | null> {
  if (!isConfigured()) return null;

  const claimed = (await query<{ was: string; now: string }>(
    `with prev as (select value as was from settings where key = 'camp_report_at')
     update settings set value = now()::text
      where key = 'camp_report_at' and value = (select was from prev)
      returning (select was from prev) as was, value as now`))[0];

  if (!claimed) {
    // Отметки не было вовсе — ставим и молчим до следующего раза.
    await query(
      `insert into settings (key, value) values ('camp_report_at', now()::text)
       on conflict (key) do nothing`);
    return null;
  }

  const rows = await query<CampChange>(
    `select coalesce(ch.name, u.name, 'участник') as who, g.title,
            s.held_on::text as day, b.status,
            (select count(*)::int from bookings b2
               join studio_sessions s2 on s2.id = b2.session_id
              where s2.group_id = g.id and b2.participant_id = p.id
                and b2.status = 'booked') as total
       from bookings b
       join studio_sessions s on s.id = b.session_id
       join studio_groups g on g.id = s.group_id and g.kind <> 'lesson'
       join participants p on p.id = b.participant_id
       left join children ch on ch.id = p.child_id
       left join users u on u.id = p.user_id
      where b.updated_at > $1::timestamptz and b.updated_at <= $2::timestamptz
      order by g.title, who, s.held_on`,
    [claimed.was, claimed.now]);
  if (rows.length === 0) return null;

  const byGroup = new Map<string, CampChange[]>();
  for (const r of rows) byGroup.set(r.title, [...(byGroup.get(r.title) ?? []), r]);

  const out: string[] = [];
  for (const [title, changes] of byGroup) {
    out.push(out.length ? `\n${title}` : title, '');
    const byWho = new Map<string, CampChange[]>();
    for (const c of changes) byWho.set(c.who, [...(byWho.get(c.who) ?? []), c]);
    for (const [who, mine] of byWho) {
      const took = mine.filter((c) => c.status === 'booked').map((c) => c.day);
      const gave = mine.filter((c) => c.status !== 'booked').map((c) => c.day);
      const parts = [
        took.length > 0 ? `+ ${daysList(took)}` : null,
        gave.length > 0 ? `− ${daysList(gave)}` : null,
      ].filter(Boolean);
      const total = mine[0].total;
      out.push(`${who} · ${parts.join(' · ')} · всего ${total} ${
        plural(total, 'день', 'дня', 'дней')}`);
    }
  }
  return out.join('\n');
}

/** Сводка по записям на смену — админам. */
export async function tellCampChanges(): Promise<number> {
  const text = await campReport();
  if (!text) return 0;
  let sent = 0;
  for (const a of await adminChats()) {
    if (await tell(a.chat, text)) sent++;
  }
  console.log(`notify: сводка по смене, отправлено ${sent}`);
  return sent;
}
