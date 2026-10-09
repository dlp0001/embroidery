import { one, query, tx } from './db';
import { BY_STUDIO, plural, todayISO, WAY, type PayMethod } from './format';
import {
  ALREADY_ISSUED, createReceipt, ICountError,
  isConfigured as receiptsConfigured,
  type Card, type Method, type PayApp, type ReceiptItem,
} from './icount';
import { logMoneyIn } from './ledger';
import { createPaymentLink, fetchTransaction, isConfigured } from './payplus';
import { coverCampDays, extendOffer, lessonPrice, saleOffers } from './studio';

export type Intent =
  | { kind: 'debt'; chargeIds?: string[] }
  /** Абонемент студии, а с groupId — пакет дней лагеря или мастер-класса. */
  | { kind: 'pass'; lessons: number; groupId?: string | null }
  /** Докупить дни в уже купленный пакет смены. */
  | { kind: 'extend'; passId: string; days: number }
  | { kind: 'test' };

/** Сумма проверочного платежа: маленькая, чтобы не жалко было вернуть. */
export const TEST_AMOUNT = 3;

/**
 * Как человек назван в документах и на кассе. Первым идёт имя, которое
 * завёл админ: по нему сходятся квитанции, выписки PayPlus и бухгалтерия.
 */
async function documentName(user: { id: string; email: string; name: string | null }): Promise<string> {
  const row = await one<{ billing_name: string | null }>(
    'select billing_name from users where id = $1',
    [user.id],
  );
  return row?.billing_name ?? user.name ?? user.email;
}

/**
 * Заводит платёж в состоянии «ждёт» и отдаёт ссылку на страницу PayPlus.
 * Что оплачивается, помним в самой записи: обратный вызов по ней и
 * поймёт, к чему привязать деньги.
 */
export async function startPayment(
  user: { id: string; email: string; name: string | null },
  intent: Intent,
  origin: string,
): Promise<{ url: string; paymentId: string } | { error: string }> {
  if (!isConfigured()) return { error: 'Оплата картой ещё не подключена.' };

  const price = await lessonPrice();
  let amount: number;
  let description: string;
  let raw: Record<string, unknown>;

  if (intent.kind === 'test') {
    amount = TEST_AMOUNT;
    description = 'Проверка оплаты';
    raw = {};
  } else if (intent.kind === 'debt') {
    // Родитель может выбрать не всё: платим ровно за отмеченное.
    const picked = intent.chargeIds?.length ? intent.chargeIds : null;
    const debts = await query<{ id: string; amount: string }>(
      `select ch.id, ch.amount::text from charges ch
        where ch.owner_id = $1 and ch.pass_id is null and ch.payment_id is null
          and ($2::uuid[] is null or ch.id = any($2::uuid[]))
          and not exists (
            select 1 from payments pay
             where pay.provider = 'cash' and pay.status = 'pending'
               and pay.purpose = 'studio_debt' and pay.user_id = ch.owner_id
               and pay.raw -> 'charge_ids' ? ch.id::text)
        order by ch.created_at`,
      [user.id, picked],
    );
    if (debts.length === 0) return { error: 'Нечего оплачивать.' };
    amount = debts.reduce((s, c) => s + Number(c.amount), 0);
    description = `Занятия в студии, ${debts.length}`;
    raw = { charge_ids: debts.map((c) => c.id) };
  } else if (intent.kind === 'extend') {
    // Цену берём у смены, а не с экрана: на экране её мог поправить кто
    // угодно, а платить человек должен ровно столько, сколько стоит день.
    const offer = await extendOffer(intent.passId, user.id);
    if (!offer) return { error: 'Этот пакет продлить нельзя.' };
    if (intent.days < 1 || intent.days > offer.maxDays) {
      return { error: 'Столько дней в смене уже не осталось.' };
    }
    amount = offer.price * intent.days;
    description = `${offer.title}: ещё ${intent.days} ${plural(intent.days, 'день', 'дня', 'дней')}`;
    raw = {
      extends_pass: offer.passId, days: intent.days,
      lessons: intent.days, group_title: offer.title,
    };
  } else {
    // Абонемент стоит своих денег, а не «занятий умножить на цену».
    const key = intent.groupId ?? '';
    const offer = (await saleOffers()).find(
      (o) => (o.groupId ?? '') === key && o.lessons === intent.lessons,
    );
    if (!offer) return { error: 'Такого абонемента нет.' };
    amount = offer.price;
    description = offer.groupTitle
      ? `${offer.groupTitle}: ${offer.lessons} ${plural(offer.lessons, 'день', 'дня', 'дней')}`
      : `Абонемент на ${offer.lessons} занятий`;
    raw = {
      lessons: offer.lessons, months: offer.months,
      group_id: offer.groupId, group_title: offer.groupTitle, valid_to: offer.validTo,
    };
  }

  const payment = await one<{ id: string }>(
    `insert into payments (provider, user_id, amount, currency, status, purpose, raw)
     values ('payplus', $1, $2, $3, 'pending', $4, $5) returning id`,
    [user.id, amount, price.currency,
     intent.kind === 'debt' ? 'studio_debt' : intent.kind === 'test' ? 'studio_test' : 'studio_pass',
     JSON.stringify(raw)],
  );

  try {
    const link = await createPaymentLink({
      amount,
      currency: price.currency,
      customerName: await documentName(user),
      email: user.email,
      description,
      reference: payment!.id,
      successUrl: `${origin}/account/pay/done?ok=1`,
      failureUrl: `${origin}/account/pay/done?ok=0`,
      callbackUrl: `${origin}/api/webhook-payplus`,
    });
    await query(
      `update payments set provider_id = $2, raw = raw || jsonb_build_object('url', $3::text)
        where id = $1`,
      [payment!.id, link.pageRequestUid, link.url],
    );
    return { url: link.url, paymentId: payment!.id };
  } catch (err) {
    console.error('payplus: не удалось создать ссылку', err);
    await query(`update payments set status = 'failed' where id = $1`, [payment!.id]);
    const reason = err instanceof Error ? err.message : 'неизвестная причина';
    return { error: `PayPlus не дал страницу оплаты: ${reason}` };
  }
}

/**
 * Отмечает платёж оплаченным и раздаёт то, за что заплатили.
 * Идемпотентно: повторный вызов ничего не меняет.
 */
export type TestPayment = { id: string; status: string; created_at: string; amount: string };

export async function lastTestPayment(userId: string): Promise<TestPayment | null> {
  return one<TestPayment>(
    `select id, status, created_at::text, amount::text from payments
      where user_id = $1 and purpose = 'studio_test'
      order by created_at desc limit 1`,
    [userId],
  );
}

export async function checkoutUrl(paymentId: string, userId: string): Promise<string | null> {
  const row = await one<{ raw: { url?: string } | null }>(
    `select raw from payments
      where id = $1 and user_id = $2 and provider = 'payplus' and status = 'pending'`,
    [paymentId, userId],
  );
  return row?.raw?.url ?? null;
}

/** Каким путём деньги дошли: звонком PayPlus или нашей же проверкой. */
export type PaidVia = 'callback' | 'return';

export async function applyPayment(
  paymentId: string,
  transactionUid: string | null,
  via: PaidVia = 'callback',
): Promise<void> {
  await tx(async (c) => {
    const { rows } = await c.query<{
      id: string; user_id: string; status: string; purpose: string;
      amount: string; currency: string; raw: Record<string, unknown> | null;
    }>('select id, user_id, status, purpose, amount, currency, raw from payments where id = $1 for update',
      [paymentId]);

    const p = rows[0];
    if (!p || p.status === 'paid') return;

    await c.query(
      `update payments set status = 'paid', provider_id = coalesce($2, provider_id) where id = $1`,
      [p.id, transactionUid],
    );
    await logMoneyIn(c, {
      kind: 'payment_paid', actorId: null, ownerId: p.user_id, paymentId: p.id,
      amount: p.amount, currency: p.currency,
      note: p.purpose === 'studio_pass' ? 'оплачен абонемент'
        : p.purpose === 'studio_debt' ? 'оплачен долг' : 'проверочный платёж',
      details: { provider: 'payplus', transaction: transactionUid, via },
    });

    // Проверочный платёж ничего не выдаёт: он нужен только чтобы
    // убедиться, что деньги доходят и обратный вызов срабатывает.
    if (p.purpose === 'studio_test') return;

    if (p.purpose === 'studio_debt' || p.purpose === 'studio_lesson') {
      const ids = (p.raw?.charge_ids as string[] | undefined) ?? [];
      if (ids.length > 0) {
        const { rows: settled } = await c.query<{ id: string }>(
          `update charges set payment_id = $1
            where id = any($2::uuid[]) and pass_id is null and payment_id is null
            returning id`,
          [p.id, ids],
        );
        for (const row of settled) {
          await logMoneyIn(c, {
            kind: 'payment_paid', actorId: null, ownerId: p.user_id,
            chargeId: row.id, paymentId: p.id, amount: null, currency: p.currency,
            note: 'занятие закрыто картой',
          });
        }
      }
      return;
    }

    // Продление: пакет не заводим заново, он просто становится больше.
    const extends_ = p.raw?.extends_pass as string | undefined;
    if (p.purpose === 'studio_pass' && extends_) {
      const days = Number(p.raw?.days ?? 0);
      if (days < 1) return;
      const { rows: grown } = await c.query<{ lessons_total: number }>(
        'update passes set lessons_total = lessons_total + $2 where id = $1 returning lessons_total',
        [extends_, days],
      );
      if (grown.length === 0) return;
      // Докупали затем, чтобы закрыть уже отхоженное: закрываем сразу,
      // иначе дни лежат в пакете, а те же дни висят долгом.
      const covered = await coverCampDays(c, extends_, null);
      await logMoneyIn(c, {
        kind: 'pass_extended', actorId: null, ownerId: p.user_id,
        passId: extends_, paymentId: p.id, amount: p.amount, currency: p.currency,
        note: `докуплено ${days} ${plural(days, 'день', 'дня', 'дней')} к пакету картой,`
          + ` всего стало ${grown[0].lessons_total}`
          + (covered > 0
            ? `, закрыто ${covered} ${plural(covered, 'день', 'дня', 'дней')}`
            : ''),
        details: { days, covered },
      });
      return;
    }

    if (p.purpose === 'studio_pass') {
      const lessons = Number(p.raw?.lessons ?? 0);
      const months = Number(p.raw?.months ?? 1);
      const groupId = (p.raw?.group_id as string | null | undefined) ?? null;
      const validTo = (p.raw?.valid_to as string | null | undefined) ?? null;
      const title = (p.raw?.group_title as string | null | undefined) ?? null;
      if (lessons < 1) return;
      const { rows: made } = await c.query<{ id: string }>(
        `insert into passes (owner_id, lessons_total, valid_from, valid_to, payment_id, group_id)
         values ($1, $2, current_date,
                 coalesce($5::date, current_date + ($3 || ' months')::interval), $4, $6)
         returning id`,
        [p.user_id, lessons, String(months), p.id, validTo, groupId],
      );
      await logMoneyIn(c, {
        kind: 'pass_issued', actorId: null, ownerId: p.user_id,
        passId: made[0].id, paymentId: p.id, amount: p.amount, currency: p.currency,
        note: title
          ? `${title}: пакет на ${lessons} ${plural(lessons, 'день', 'дня', 'дней')}, оплачен картой`
          : `абонемент на ${lessons} ${plural(lessons, 'занятие', 'занятия', 'занятий')}, оплачен картой`,
        details: { lessons, months, group_id: groupId },
      });
    }
  });
}

// ── Квитанции iCount ──────────────────────────────────────

/** Русский родителю, иврит бухгалтерии. */
function line(ru: string, he: string): string {
  return `${ru} | ${he}`;
}

const LESSON = line('Занятие', 'שיעור');

/**
 * Как называется занятие в чеке. Кейтана — отдельная услуга, и в ивритской
 * половине строки это должно быть видно: её читает бухгалтерия, а название
 * смены у нас русское.
 */
function lessonOf(kind: string): string {
  if (kind === 'camp') return line('Занятие в дни лагеря', 'שיעור בקייטנה');
  if (kind === 'event') return line('Занятие на мастер-классе', 'שיעור בסדנה');
  return LESSON;
}

/**
 * Сколько дней на иврите. Докупают чаще всего один день, а «1 ימים» —
 * ошибка, которую в чеке прочтёт бухгалтерия.
 */
function daysHe(days: number): string {
  return days === 1 ? 'יום אחד' : `${days} ימים`;
}

/** Докупленные дни: пакет тот же, в чеке — только добавка к нему. */
function extraDaysLine(kind: string, title: string | null, days: number): string {
  const he = kind === 'event' ? 'סדנה' : 'קייטנה';
  return line(
    `Дополнительные дни${title ? `: ${title}` : ''}, ${days} ${plural(days, 'день', 'дня', 'дней')}`,
    `ימים נוספים ל${he}: ${daysHe(days)}`,
  );
}

/**
 * Пакет дней в чеке. Русскому родителю — с названием смены целиком, чтобы
 * было видно, за что платил. Ивритской половине название не подставить:
 * оно у нас русское, а читать её будет бухгалтерия.
 */
function packageLine(kind: string, title: string, days: number): string {
  const he = kind === 'event' ? 'סדנה' : 'קייטנה';
  return line(
    `Пакет занятий: ${title}, ${days} ${plural(days, 'день', 'дня', 'дней')}`,
    `חבילה ל${he}: ${daysHe(days)}`,
  );
}

type ToBill = {
  id: string; provider: string; amount: string; currency: string; purpose: string | null;
  raw: Record<string, unknown> | null; user_id: string; email: string;
  name: string | null; billing_name: string | null;
};

/** Чем закрыт платёж с точки зрения квитанции. */
function receiptMethod(p: ToBill): { method: Method; app: PayApp | null } {
  // Способ спрашивают там, где деньги принимают руками, и он точнее
  // провайдера: биток и пейбокс приходят на счёт, но это не перевод.
  const how = p.raw?.pay_method;
  if (how === 'bit' || how === 'paybox') return { method: 'app', app: how };
  if (how === 'transfer') return { method: 'transfer', app: null };
  if (how === 'cash') return { method: 'cash', app: null };
  // Способа нет — остаётся провайдер. Перевод живёт в банке, а не в
  // кассе и не на карте: iCount просит для него номер счёта.
  if (p.provider === 'transfer') return { method: 'transfer', app: null };
  if (p.provider !== 'cash') return { method: 'cc', app: null };
  return { method: 'cash', app: null };
}

/**
 * На какой счёт компании пришёл перевод. iCount без этого номера
 * банковский перевод не примет, а списать его на кассу нельзя: деньги
 * лежат в банке, и в отчётности это разные места.
 */
function transferAccount(): number | null {
  const raw = Number(process.env.ICOUNT_BANK_ACCOUNT ?? '');
  return Number.isInteger(raw) && raw > 0 ? raw : null;
}

/**
 * Позиции квитанции. Занятия идут одной строкой с количеством, а не
 * списком: так родителю видно цену за занятие. Если посреди долга
 * занятие подорожало, строк будет столько, сколько было цен.
 */
async function receiptItems(p: ToBill): Promise<ReceiptItem[]> {
  const total = Number(p.amount);

  if (p.purpose === 'studio_pass') {
    // Продление: в пакете стало больше дней, нового пакета не появилось.
    // Число дней берём из самого платежа: у него оно и есть.
    const extends_ = p.raw?.extends_pass as string | undefined;
    if (extends_) {
      const days = Number(p.raw?.days ?? 0);
      const pass = await one<{ title: string | null; kind: string | null }>(
        `select g.title, g.kind from passes ps
           left join studio_groups g on g.id = ps.group_id
          where ps.id = $1`,
        [extends_],
      );
      return [{
        description: extraDaysLine(pass?.kind ?? 'camp', pass?.title ?? null, days),
        quantity: 1,
        price: total,
      }];
    }

    const n = Number(p.raw?.lessons ?? 0);
    const title = (p.raw?.group_title as string | null | undefined) ?? null;
    const groupId = (p.raw?.group_id as string | null | undefined) ?? null;
    const kind = groupId
      ? (await one<{ kind: string }>('select kind from studio_groups where id = $1', [groupId]))?.kind ?? 'camp'
      : 'lesson';
    return [{
      description: title
        ? packageLine(kind, title, n)
        : line(
            `Абонемент на ${n} ${plural(n, 'занятие', 'занятия', 'занятий')}`,
            n === 1 ? 'מנוי לשיעור אחד' : `מנוי ל-${n} שיעורים`,
          ),
      quantity: 1,
      price: total,
    }];
  }

  if (p.purpose === 'studio_debt' || p.purpose === 'studio_lesson') {
    // Делим не только по цене, но и по виду: день лагеря за 330 ₪ и
    // обычное занятие за 100 ₪ — разные услуги, а не разный прайс.
    const groups = await query<{ kind: string; price: string; count: number }>(
      `select g.kind, ch.amount::text as price, count(*)::int as count
         from charges ch
         join studio_sessions s on s.id = ch.session_id
         join studio_groups g on g.id = s.group_id
        where ch.payment_id = $1
        group by g.kind, ch.amount
        order by g.kind, ch.amount`,
      [p.id],
    );
    const sum = groups.reduce((s, g) => s + Number(g.price) * g.count, 0);
    // Начисления могли и не сойтись с платежом: тогда честнее одна строка
    // на всю сумму, чем красивая разбивка, которая врёт в итоге.
    if (groups.length > 0 && Math.abs(sum - total) < 0.01) {
      return groups.map((g) => ({
        description: lessonOf(g.kind), quantity: g.count, price: Number(g.price),
      }));
    }
    return [{ description: LESSON, quantity: 1, price: total }];
  }

  return [{
    description: line('Проверка оплаты', 'בדיקת תשלום'), quantity: 1, price: total,
  }];
}

const UNBILLED = `select p.id, p.provider, p.amount::text, p.currency, p.purpose, p.raw,
            u.id as user_id, u.name, u.billing_name, u.email
       from payments p join users u on u.id = p.user_id
      where p.status = 'paid' and p.invoice_url is null and p.raw -> 'receipt' is null
        /* Подарок закрыт нулевым платежом: чек на ноль не выписывают. */
        and p.provider <> 'gift'
        /* Картой — квитанция всегда. Деньги, отданные Варе в руки, только
           если она сама попросила чек: иначе выпишем лишнюю бумагу. */
        and (p.provider <> 'cash' or p.raw ->> 'receipt_wanted' = 'yes')
        /* Сказали «чек не нужен» — значит не нужен и по переводу: это
           ответ на галочку в форме, а не молчание старого платежа. */
        and coalesce(p.raw ->> 'receipt_wanted', '') <> 'no'`;

/**
 * Подпись способа оплаты: по ней решаем, какие платежи лягут в одну
 * бумагу. Биток и пейбокс для iCount разные способы, и складывать их
 * в один чек нельзя, даже если платил один человек.
 */
function methodKey(p: ToBill): string {
  const w = receiptMethod(p);
  return `${w.method}:${w.app ?? ''}`;
}

/** Складывает одинаковые позиции: три чека по сотне дают «занятие ×3». */
function mergeItems(lists: ReceiptItem[][], total: number): ReceiptItem[] {
  const by = new Map<string, ReceiptItem>();
  for (const items of lists) {
    for (const i of items) {
      const key = `${i.description}|${i.price}`;
      const had = by.get(key);
      if (had) had.quantity += i.quantity;
      else by.set(key, { ...i });
    }
  }
  const items = [...by.values()];
  const sum = items.reduce((s, i) => s + i.price * i.quantity, 0);
  // Позиции обязаны сходиться с суммой документа. Не сошлись — одна
  // строка на всё: красивая разбивка, которая врёт в итоге, хуже.
  return Math.abs(sum - total) < 0.01
    ? items
    : [{ description: LESSON, quantity: 1, price: total }];
}

/**
 * Одна квитанция на набор платежей. Набор должен быть однородным:
 * один плательщик, один способ, одна валюта — это и есть то, что
 * бумага утверждает про деньги.
 *
 * Ошибка iCount не должна ронять зачёт денег: занятия важнее бумажки,
 * поэтому здесь мы только пишем в журнал, а следующая попытка выпишет
 * ещё раз. Второй квитанции не будет — iCount отбивает повтор сам по
 * нашему же идентификатору.
 */
async function issueOne(group: ToBill[], card?: Card | null): Promise<boolean> {
  const head = group[0];
  if (!head) return false;
  const ids = group.map((p) => p.id);
  const total = group.reduce((s, p) => s + Number(p.amount), 0);

  const way = receiptMethod(head);
  const account = way.method === 'transfer' ? transferAccount() : null;
  if (way.method === 'transfer' && account === null) {
    // Лучше не выписать бумагу, чем выписать неверную: перевод, поданный
    // как наличные, расходится с банковской выпиской.
    console.error(
      'icount: перевод не оформить, не задан ICOUNT_BANK_ACCOUNT. Платёж', head.id);
    return false;
  }

  try {
    const doc = await createReceipt({
      paymentId: head.id,
      userId: head.user_id,
      // В квитанции человек назван так, как его завёл админ: имена в
      // отчётности должны сходиться между собой, а не с кабинетом.
      customerName: head.billing_name ?? head.name ?? head.email,
      email: head.email,
      items: mergeItems(await Promise.all(group.map(receiptItems)), total),
      amount: total,
      currency: head.currency,
      ...way,
      transfer: account === null ? null : { account, date: todayISO() },
      card,
    });
    await query(
      `update payments set invoice_url = $2,
              raw = coalesce(raw, '{}'::jsonb) || jsonb_build_object('receipt', $3::jsonb)
        where id = any($1::uuid[])`,
      [ids, doc.url, JSON.stringify({ docnum: doc.docnum })],
    );
    console.log('icount: выписана квитанция', doc.docnum, 'на платежи', ids.join(', '));
    return true;
  } catch (err) {
    // Квитанция уже выписана, но ссылку на неё iCount в отказе не вернул.
    // Помечаем платежи, иначе будем проситься за ней каждый раз.
    if (err instanceof ICountError && err.reason === ALREADY_ISSUED) {
      await query(
        `update payments set raw = coalesce(raw, '{}'::jsonb) || '{"receipt":{"exists":true}}'::jsonb
          where id = any($1::uuid[])`,
        [ids],
      );
      return true;
    }
    console.error('icount: квитанция не выписана', ids.join(', '), err);
    return false;
  }
}

/** Выписывает квитанцию на один платёж: так ходит автоматическая выписка. */
export async function issueReceipt(paymentId: string, card?: Card | null): Promise<void> {
  if (!receiptsConfigured()) return;
  const p = await one<ToBill>(`${UNBILLED} and p.id = $1`, [paymentId]);
  if (!p) return;
  await issueOne([p], card);
}

export type Issued = { docs: number; failed: number };

/**
 * Выписывает бумаги по набору платежей, складывая в одну те, что
 * принадлежат одному плательщику и пришли одним способом.
 *
 * Родитель, отдавший три сотни за три занятия, получает один чек с
 * строкой «занятие ×3», а не три бумаги по сотне: в журнале это три
 * отметки, но деньги он доставал из кармана один раз. Разные способы не
 * смешиваем — чек утверждает, как именно пришли деньги.
 */
export async function issueReceiptFor(ids: string[], limit = 10): Promise<Issued> {
  const out: Issued = { docs: 0, failed: 0 };
  if (!receiptsConfigured() || ids.length === 0) return out;

  const rows = await query<ToBill>(
    `${UNBILLED} and p.id = any($1::uuid[]) order by p.created_at`, [ids]);

  const groups = new Map<string, ToBill[]>();
  for (const p of rows) {
    const key = `${p.user_id}|${p.currency}|${methodKey(p)}`;
    groups.set(key, [...(groups.get(key) ?? []), p]);
  }

  for (const group of [...groups.values()].slice(0, limit)) {
    if (await issueOne(group)) out.docs++;
    else out.failed++;
  }
  return out;
}

/** Догоняет квитанции, которые в свой час не выписались. */
async function sweepReceipts(userId: string): Promise<void> {
  if (!receiptsConfigured()) return;
  const late = await query<{ id: string }>(
    `${UNBILLED} and p.user_id = $1 and p.created_at > now() - interval '30 days'
      order by p.created_at desc limit 3`,
    [userId],
  );
  for (const p of late) await issueReceipt(p.id);
}

/**
 * Спрашивает у PayPlus про зависшие платежи родителя и доводит их до конца.
 *
 * Обратный вызов может не дойти: его глушит сеть, деплой или сам PayPlus.
 * Поэтому не полагаемся на него как на единственный источник правды —
 * когда человек возвращается с кассы, переспрашиваем сами. Повторный
 * вызов безопасен: applyPayment идемпотентен.
 */
export type PendingCheck = { paid: number; failed: number; waiting: number };

export async function verifyPending(userId: string): Promise<PendingCheck> {
  const out: PendingCheck = { paid: 0, failed: 0, waiting: 0 };
  if (!isConfigured()) return out;

  const pending = await query<{ id: string; provider_id: string | null; amount: string }>(
    `select id, provider_id, amount::text from payments
      where user_id = $1 and provider = 'payplus' and status = 'pending'
        and provider_id is not null
        and created_at > now() - interval '2 days'
      order by created_at desc limit 5`,
    [userId],
  );

  for (const p of pending) {
    let check;
    try {
      check = await fetchTransaction({ pageRequestUid: p.provider_id! });
    } catch (err) {
      console.error('payplus: не удалось переспросить про платёж', p.id, err);
      out.waiting++;
      continue;
    }

    if (!check.paid) {
      // Пустой статус значит «человек ещё не платил», а не «отказано».
      if (check.statusCode && check.statusCode !== '000') {
        await query(`update payments set status = 'failed' where id = $1 and status = 'pending'`, [p.id]);
        out.failed++;
      } else {
        out.waiting++;
      }
      continue;
    }

    if (check.amount !== null && Math.abs(check.amount - Number(p.amount)) > 0.01) {
      console.error('payplus: сумма разошлась при проверке', p.id, check.amount, p.amount);
      out.waiting++;
      continue;
    }

    await applyPayment(p.id, check.transactionUid, 'return');
    await issueReceipt(p.id, check.card);
    out.paid++;
  }

  await sweepReceipts(userId);
  return out;
}

// ── Наличные по заявке родителя ───────────────────────────

export type CashClaim = {
  id: string;
  amount: string;
  currency: string;
  created_at: string;
  owner_name: string | null;
  owner_email: string;
  /** Чем родитель обещал отдать. У старых заявок пусто: поля тогда не было. */
  declared_way: 'cash' | 'transfer' | null;
  lessons: number;
};

/**
 * Родитель заявляет, что заплатит студии напрямую. Деньги не считаются
 * полученными, пока студия не подтвердит: занятия остаются в долгу.
 */
export async function declareCash(
  user: { id: string },
  chargeIds: string[],
  /** Чем родитель собирается отдать: наличными или переводом. */
  way: 'cash' | 'transfer' = 'cash',
): Promise<{ ok: true; count: number } | { error: string }> {
  const picked = chargeIds.length ? chargeIds : null;
  const debts = await query<{ id: string; amount: string; currency: string }>(
    `select ch.id, ch.amount::text, ch.currency from charges ch
      where ch.owner_id = $1 and ch.pass_id is null and ch.payment_id is null
        and ($2::uuid[] is null or ch.id = any($2::uuid[]))
        and not exists (
          select 1 from payments pay
           where pay.provider = 'cash' and pay.status = 'pending'
             and pay.purpose = 'studio_debt' and pay.user_id = ch.owner_id
             and pay.raw -> 'charge_ids' ? ch.id::text)
      order by ch.created_at`,
    [user.id, picked],
  );
  if (debts.length === 0) return { error: 'Нечего оплачивать.' };

  const amount = debts.reduce((s, c) => s + Number(c.amount), 0);
  const currency = debts[0].currency;

  await tx(async (c) => {
    const { rows } = await c.query<{ id: string }>(
      `insert into payments (provider, user_id, amount, currency, status, purpose, raw)
       values ('cash', $1, $2, $3, 'pending', 'studio_debt', $4) returning id`,
      [user.id, amount, currency,
       JSON.stringify({ charge_ids: debts.map((d) => d.id), declared_way: way })],
    );
    await logMoneyIn(c, {
      kind: 'cash_declared', actorId: user.id, ownerId: user.id,
      paymentId: rows[0].id, amount, currency,
      note: `родитель заявил оплату ${WAY[way]} за ${debts.length} ${plural(debts.length, 'занятие', 'занятия', 'занятий')}`,
      details: { charge_ids: debts.map((d) => d.id) },
    });
  });

  return { ok: true, count: debts.length };
}

/** Заявки, которые ждут подтверждения студии. */
export async function pendingCash(): Promise<CashClaim[]> {
  return query<CashClaim>(
    `select p.id, p.amount::text, p.currency, p.created_at::text,
            u.name as owner_name, u.email as owner_email,
            p.raw ->> 'declared_way' as declared_way,
            coalesce(jsonb_array_length(p.raw -> 'charge_ids'), 0) as lessons
       from payments p
       join users u on u.id = p.user_id
      where p.provider = 'cash' and p.status = 'pending' and p.purpose = 'studio_debt'
      order by p.created_at`,
  );
}

/** Студия подтверждает получение денег: занятия закрываются. */
/** Чем родитель на самом деле отдал деньги и нужна ли ему квитанция. */
export type CashDetails = { method: PayMethod; receipt: boolean };

export async function confirmCash(
  paymentId: string, actorId: string, how: CashDetails,
): Promise<void> {
  await tx(async (c) => {
    const { rows } = await c.query<{
      id: string; user_id: string; status: string; amount: string; currency: string;
      raw: { charge_ids?: string[] } | null;
    }>(
      `select id, user_id, status, amount::text, currency, raw from payments
        where id = $1 and provider = 'cash' and purpose = 'studio_debt' for update`,
      [paymentId],
    );
    const p = rows[0];
    if (!p || p.status !== 'pending') return;

    // Способ и просьбу о чеке помним в самом платеже: квитанцию выпишем
    // после транзакции, а если iCount откажет — по этой пометке попробуем ещё.
    await c.query(
      `update payments set status = 'paid',
              raw = coalesce(raw, '{}'::jsonb) || jsonb_build_object(
                      'pay_method', $2::text,
                      'receipt_wanted', $3::text,
                      'receipt_asked_at', now()::text)
        where id = $1`,
      [p.id, how.method, how.receipt ? 'yes' : 'no'],
    );
    const ids = p.raw?.charge_ids ?? [];
    if (ids.length > 0) {
      await c.query(
        `update charges set payment_id = $1
          where id = any($2::uuid[]) and pass_id is null and payment_id is null`,
        [p.id, ids],
      );
    }
    await logMoneyIn(c, {
      kind: 'cash_confirmed', actorId, ownerId: p.user_id, paymentId: p.id,
      amount: p.amount, currency: p.currency,
      note: `подтверждено получение денег за ${ids.length} ${
        plural(ids.length, 'занятие', 'занятия', 'занятий')}, ${WAY[how.method]}`,
      details: { pay_method: how.method, receipt: how.receipt },
    });
  });

  // Квитанция — уже после того, как деньги зачтены: отказ iCount не должен
  // отменять подтверждение, за которое Варя уже нажала кнопку.
  if (how.receipt) await issueReceipt(paymentId);
}

export type TakenCash = {
  ownerId: string;
  chargeIds: string[];
  method: PayMethod;
  receipt: boolean;
};

/**
 * Деньги принесли в студию, и Варя проводит их сама: выбрала семью,
 * отметила занятия, назвала способ. От заявки родителя это отличается
 * тем, что подтверждать нечего — платёж сразу оплачен.
 *
 * Занятия берём под замок и только те, что ещё никому не отданы: пока
 * страница была открыта, их могли закрыть абонементом или другим
 * платежом, и второй раз брать за них деньги нельзя.
 */
export async function takeCash(
  input: TakenCash, actorId: string,
): Promise<{ ok: boolean; error?: string; paymentId?: string; count?: number }> {
  if (input.chargeIds.length === 0) return { ok: false, error: 'Отметьте занятия.' };

  const done = await tx(async (c) => {
    const { rows: debts } = await c.query<{ id: string; amount: string; currency: string }>(
      `select ch.id, ch.amount::text, ch.currency
         from charges ch
        where ch.owner_id = $1 and ch.id = any($2::uuid[])
          and ch.pass_id is null and ch.payment_id is null
          /* Занятие, на которое родитель уже подал заявку, проводим
             через неё: иначе за одни деньги будет два платежа. */
          and not exists (
            select 1 from payments pay
             where pay.provider = 'cash' and pay.status = 'pending'
               and pay.purpose = 'studio_debt' and pay.user_id = ch.owner_id
               and pay.raw -> 'charge_ids' ? ch.id::text)
        order by ch.created_at
        for update of ch`,
      [input.ownerId, input.chargeIds],
    );
    if (debts.length === 0) {
      return { ok: false, error: 'Эти занятия уже закрыты или ждут подтверждения.' };
    }

    const amount = debts.reduce((sum, d) => sum + Number(d.amount), 0);
    const currency = debts[0].currency;
    const ids = debts.map((d) => d.id);

    const { rows } = await c.query<{ id: string }>(
      `insert into payments (provider, user_id, amount, currency, status, purpose, raw)
       values ($1, $2, $3, $4, 'paid', 'studio_debt', $5) returning id`,
      [BY_STUDIO, input.ownerId, amount, currency,
       JSON.stringify({
         charge_ids: ids, taken_by: actorId,
         pay_method: input.method,
         receipt_wanted: input.receipt ? 'yes' : 'no',
         receipt_asked_at: new Date().toISOString(),
       })],
    );
    const paymentId = rows[0].id;
    await c.query(
      `update charges set payment_id = $1 where id = any($2::uuid[])`,
      [paymentId, ids],
    );
    await logMoneyIn(c, {
      kind: 'cash_taken', actorId, ownerId: input.ownerId, paymentId,
      amount, currency,
      note: `приняли оплату за ${ids.length} ${
        plural(ids.length, 'занятие', 'занятия', 'занятий')}, ${WAY[input.method]}`,
      details: { pay_method: input.method, receipt: input.receipt, charge_ids: ids },
    });
    return { ok: true, paymentId, count: ids.length };
  });

  return done;
}

export async function declineCash(
  paymentId: string, actorId: string, note = 'заявка на оплату отклонена',
): Promise<void> {
  await tx(async (c) => {
    const { rows } = await c.query<{ id: string; user_id: string; status: string; amount: string; currency: string }>(
      `select id, user_id, status, amount::text, currency from payments
        where id = $1 and provider = 'cash' and purpose = 'studio_debt' for update`,
      [paymentId],
    );
    const p = rows[0];
    if (!p || p.status !== 'pending') return;
    await c.query(`update payments set status = 'failed' where id = $1`, [p.id]);
    await logMoneyIn(c, {
      kind: 'cash_declined', actorId, ownerId: p.user_id, paymentId: p.id,
      amount: p.amount, currency: p.currency, note,
    });
  });
}

export type UnfinishedPayment = {
  id: string;
  amount: string;
  currency: string;
  purpose: string;
  created_at: string;
  group_title: string | null;
  lessons: number;
};

/**
 * Платежи картой, начатые и не доведённые до конца: человек ушёл со
 * страницы банка или закрыл её. Ссылка на кассу у нас сохранена, так что
 * такой платёж можно продолжить, а не начинать заново.
 *
 * Берём только свежие: страницы оплаты у PayPlus живут недолго.
 */
export async function unfinishedPayments(userId: string): Promise<UnfinishedPayment[]> {
  return query<UnfinishedPayment>(
    `select id, amount::text, currency, purpose, created_at::text,
            raw ->> 'group_title' as group_title,
            coalesce(jsonb_array_length(raw -> 'charge_ids'), 0) as lessons
       from payments
      where user_id = $1 and provider = 'payplus' and status = 'pending'
        and raw ? 'url' and created_at > now() - interval '2 days'
      order by created_at desc`,
    [userId],
  );
}

/** Родитель отказался от начатого платежа: ссылка на кассу больше не нужна. */
export async function dropPayment(paymentId: string, userId: string): Promise<void> {
  await tx(async (c) => {
    const { rows } = await c.query<{ id: string; amount: string; currency: string }>(
      `select id, amount::text, currency from payments
        where id = $1 and user_id = $2 and provider = 'payplus' and status = 'pending'
        for update`,
      [paymentId, userId],
    );
    const p = rows[0];
    if (!p) return;
    await c.query(`update payments set status = 'failed' where id = $1`, [p.id]);
    await logMoneyIn(c, {
      kind: 'payment_dropped', actorId: userId, ownerId: userId, paymentId: p.id,
      amount: p.amount, currency: p.currency, note: 'начатый платёж отменён родителем',
    });
  });
}

/** Заявка родителя, которая ещё ждёт подтверждения. */
export async function myPendingCash(userId: string): Promise<CashClaim | null> {
  return one<CashClaim>(
    `select p.id, p.amount::text, p.currency, p.created_at::text,
            u.name as owner_name, u.email as owner_email,
            p.raw ->> 'declared_way' as declared_way,
            coalesce(jsonb_array_length(p.raw -> 'charge_ids'), 0) as lessons
       from payments p join users u on u.id = p.user_id
      where p.user_id = $1 and p.provider = 'cash'
        and p.status = 'pending' and p.purpose = 'studio_debt'
      order by p.created_at desc limit 1`,
    [userId],
  );
}


export type PaymentRow = {
  id: string;
  at: string;
  provider: string;
  status: string;
  purpose: string | null;
  amount: string;
  currency: string;
  lessons: number;
  invoice_url: string | null;
  /** Чем отдали деньги напрямую: наличными, переводом, битом, пейбоксом. */
  pay_method: PayMethod | null;
  /** Пакет лагеря: в истории он зовётся своим именем, а не абонементом. */
  group_title: string | null;
};

/** Все платежи родителя: картой, напрямую и абонементы. */
export async function paymentHistory(userId: string): Promise<PaymentRow[]> {
  return query<PaymentRow>(
    `select p.id, p.created_at::text as at, p.provider, p.status, p.purpose,
            p.amount::text, p.currency, p.invoice_url,
            p.raw ->> 'pay_method' as pay_method,
            (select g.title from passes ps
               join studio_groups g on g.id = ps.group_id
              where ps.payment_id = p.id) as group_title,
            coalesce(
              jsonb_array_length(p.raw -> 'charge_ids'),
              (p.raw ->> 'lessons')::int,
              (select ps.lessons_total from passes ps where ps.payment_id = p.id),
              0) as lessons
       from payments p
      where p.user_id = $1
      order by p.created_at desc
      limit 50`,
    [userId],
  );
}

export type TakenRow = PaymentRow & {
  /** Кто заплатил: имя, а если его нет — почта. */
  who: string;
  /** Докупленные в пакет дни: такой платёж не абонемент и не занятие. */
  extra_days: number;
};

/**
 * Полученные деньги: всё, что студия действительно получила. Карта,
 * наличные, переводы, абонементы и докупленные дни.
 *
 * Незавершённые попытки картой и неподтверждённые заявки сюда не
 * попадают: это намерения, а не деньги. Подарок тоже — нулевой платёж
 * деньгами не был, а проверочные платежи это и вовсе не касса.
 */
export async function paymentsTaken(limit = 150): Promise<TakenRow[]> {
  return query<TakenRow>(
    `select p.id, p.created_at::text as at, p.provider, p.status, p.purpose,
            p.amount::text, p.currency, p.invoice_url,
            p.raw ->> 'pay_method' as pay_method,
            coalesce(u.name, u.email, 'без плательщика') as who,
            case when p.raw ? 'extends_pass'
                 then coalesce((p.raw ->> 'days')::int, 0) else 0 end as extra_days,
            (select g.title from passes ps
               join studio_groups g on g.id = ps.group_id
              where ps.payment_id = p.id) as group_title,
            coalesce(
              jsonb_array_length(p.raw -> 'charge_ids'),
              nullif((select count(*)::int from charges ch where ch.payment_id = p.id), 0),
              (select ps.lessons_total from passes ps where ps.payment_id = p.id),
              0) as lessons
       from payments p
       left join users u on u.id = p.user_id
      where p.status = 'paid'
        and p.provider <> 'gift'
        and p.purpose is distinct from 'studio_test'
      order by p.created_at desc
      limit $1`,
    [limit],
  );
}

/**
 * Сколько денег пришло за промежуток. Считается по дню платежа, а не по
 * дню занятия: это касса, а не реализация. Подарки и проверочные платежи
 * не в счёт — за ними денег нет.
 */
export async function takenBetween(
  from: string, to: string,
): Promise<{ sum: number; count: number; currency: string }> {
  const row = await one<{ sum: string; count: number; currency: string | null }>(
    `select coalesce(sum(p.amount), 0)::text as sum, count(*)::int as count,
            min(p.currency) as currency
       from payments p
      where p.status = 'paid'
        and p.provider <> 'gift'
        and p.purpose is distinct from 'studio_test'
        and p.created_at >= $1::date
        and p.created_at < ($2::date + 1)`,
    [from, to],
  );
  return {
    sum: Number(row?.sum ?? 0),
    count: row?.count ?? 0,
    currency: row?.currency ?? 'ILS',
  };
}
