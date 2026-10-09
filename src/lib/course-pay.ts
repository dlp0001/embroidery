import { createHmac, timingSafeEqual } from 'node:crypto';
import { courseBySlug, grantAccess, sendLink } from './course';
import { one, query } from './db';
import { ALREADY_ISSUED, createReceipt, ICountError, isConfigured as receiptsReady, type Card } from './icount';
import { createPaymentLink } from './payplus';
import { siteOrigin } from './site';

/**
 * Оплата курса. Три кассы, у каждой своя страна:
 *
 *   ils  — израильские карты, PayPlus. Квитанцию выписываем в iCount сами.
 *   intl — иностранные карты, Polar. Он продавец перед покупателем
 *          (Merchant of Record) и шлёт квитанцию сам, iCount не трогаем.
 *   ru   — Россия, ЮKassa. Чек по 54-ФЗ отправляет она сама.
 *
 * Сначала заводим строку в course_checkouts и отдаём её id кассе. Касса
 * возвращает его в вебхуке, и по нему мы знаем, чей это платёж и сколько
 * должно было прийти. Вебхуку не верим на слово: PayPlus и ЮKassa
 * переспрашиваем по API, у Polar проверяем подпись.
 *
 * Деньги курса в payments не попадают: там деньги студии, и «Чеки»
 * студии про курс знать не должны.
 */

export type PayMethod = 'ils' | 'intl' | 'ru';

type Offer = {
  ils: number;
  usd: number;
  rub: number;
  /** Товар в Polar. Цену в долларах Polar берёт из него, а не от нас. */
  polarProduct: string | null;
  /** Строка в квитанции и на странице кассы. */
  item: string;
};

const OFFERS: Record<string, Offer> = {
  embroidery: {
    ils: 240,
    usd: 80,
    rub: 6800,
    polarProduct: null,
    item: 'Видеокурс по вышивке «Как вышить в современном мире», доступ на 6 месяцев',
  },
};

const PROVIDER: Record<PayMethod, 'payplus' | 'polar' | 'yookassa'> = {
  ils: 'payplus',
  intl: 'polar',
  ru: 'yookassa',
};

const YOOKASSA_SHOP_ID = '1351165';

function yookassaAuth(): string {
  return `Basic ${Buffer.from(`${YOOKASSA_SHOP_ID}:${process.env.YOOKASSA_API_KEY ?? ''}`).toString('base64')}`;
}

export type StartInput = {
  slug: string;
  method: PayMethod;
  name: string;
  email: string;
  consents?: { data: boolean; marketing: boolean; version: string } | null;
  ip?: string | null;
  userAgent?: string | null;
};

export type StartResult = { ok: true; url: string } | { ok: false; error: string };

/** Форма на лендинге → страница кассы. */
export async function startCheckout(input: StartInput): Promise<StartResult> {
  const name = input.name.trim();
  const email = input.email.trim().toLowerCase();
  if (!name) return { ok: false, error: 'Как вас зовут?' };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, error: 'Проверьте адрес почты' };

  const offer = OFFERS[input.slug];
  const course = offer ? await courseBySlug(input.slug) : null;
  if (!offer || !course) return { ok: false, error: 'Курс не найден' };

  const provider = PROVIDER[input.method];
  if (!provider) return { ok: false, error: 'Выберите способ оплаты' };
  if (provider === 'polar' && !offer.polarProduct) {
    return { ok: false, error: 'Оплата в долларах пока не подключена. Напишите на info@re-create.art.' };
  }
  if (provider === 'yookassa' && !(input.consents?.data && input.consents?.marketing)) {
    return { ok: false, error: 'Отметьте оба согласия, без них ЮKassa не примет оплату' };
  }

  const amount = provider === 'payplus' ? offer.ils : provider === 'polar' ? offer.usd : offer.rub;
  const currency = provider === 'payplus' ? 'ILS' : provider === 'polar' ? 'USD' : 'RUB';
  const consents = input.consents
    ? { ...input.consents, ip: input.ip ?? null, userAgent: input.userAgent?.slice(0, 300) ?? null, at: new Date().toISOString() }
    : null;

  const checkout = await one<{ id: string }>(
    `insert into course_checkouts (course_id, email, name, provider, amount, currency, consents)
     values ($1, $2, $3, $4, $5, $6, $7) returning id`,
    [course.id, email, name, provider, amount, currency, consents ? JSON.stringify(consents) : null],
  );
  const id = checkout!.id;
  const origin = await siteOrigin();
  const thanks = `${origin}/learn/${input.slug}/thanks`;

  try {
    let ref: string;
    let url: string;

    if (provider === 'payplus') {
      const link = await createPaymentLink({
        amount,
        currency,
        customerName: name,
        email,
        description: offer.item,
        reference: `course:${id}`,
        successUrl: thanks,
        failureUrl: `${origin}/embroidery`,
        callbackUrl: `${origin}/api/webhook-payplus`,
      });
      ref = link.pageRequestUid;
      url = link.url;
    } else if (provider === 'polar') {
      const res = await fetch('https://api.polar.sh/v1/checkouts', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.POLAR_ACCESS_TOKEN ?? ''}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          products: [offer.polarProduct],
          customer_email: email,
          customer_name: name,
          ...(input.ip ? { customer_ip_address: input.ip } : {}),
          success_url: thanks,
          metadata: { course: input.slug, checkout: id },
        }),
        signal: AbortSignal.timeout(15_000),
      });
      const data = (await res.json()) as { id?: string; url?: string };
      if (!res.ok || !data.url || !data.id) throw new Error(`Polar ${res.status}: ${JSON.stringify(data).slice(0, 200)}`);
      ref = data.id;
      url = data.url;
    } else {
      const res = await fetch('https://api.yookassa.ru/v3/payments', {
        method: 'POST',
        headers: {
          Authorization: yookassaAuth(),
          'Content-Type': 'application/json',
          // Повтор того же запроса не создаст второй платёж.
          'Idempotence-Key': id,
        },
        body: JSON.stringify({
          amount: { value: amount.toFixed(2), currency },
          confirmation: { type: 'redirect', return_url: thanks },
          capture: true,
          description: offer.item.slice(0, 128),
          receipt: {
            customer: { email },
            items: [{
              description: offer.item.slice(0, 128),
              quantity: '1.00',
              amount: { value: amount.toFixed(2), currency },
              vat_code: 1,
              payment_mode: 'full_payment',
              payment_subject: 'service',
            }],
          },
          metadata: { course: input.slug, checkout: id, email },
        }),
        signal: AbortSignal.timeout(15_000),
      });
      const data = (await res.json()) as { id?: string; confirmation?: { confirmation_url?: string } };
      const confirm = data.confirmation?.confirmation_url;
      if (!res.ok || !data.id || !confirm) throw new Error(`ЮKassa ${res.status}: ${JSON.stringify(data).slice(0, 200)}`);
      ref = data.id;
      url = confirm;
    }

    await query('update course_checkouts set provider_ref = $2 where id = $1', [id, ref]);
    return { ok: true, url };
  } catch (err) {
    console.error(`course checkout ${provider}: касса не ответила`, err);
    return { ok: false, error: 'Не получилось открыть страницу оплаты. Попробуйте ещё раз или напишите на info@re-create.art.' };
  }
}

// ── После оплаты ──────────────────────────────────────────

type CheckoutRow = {
  id: string;
  slug: string;
  email: string;
  name: string | null;
  provider: string;
  amount: string;
  currency: string;
};

async function checkoutById(id: string): Promise<CheckoutRow | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  return one<CheckoutRow>(
    `select k.id, c.slug, k.email, k.name, k.provider, k.amount::text, k.currency
       from course_checkouts k join courses c on c.id = k.course_id
      where k.id = $1`,
    [id],
  );
}

export type Paid = {
  provider: 'payplus' | 'polar' | 'yookassa';
  /** Идентификатор платежа у кассы: по нему повторный вебхук узнаётся. */
  providerId: string;
  checkoutId: string | null;
  /** Без начатой оплаты (Polar без metadata) курс и почту берём из заказа. */
  slug?: string;
  email?: string;
  name?: string | null;
  /** Что пришло на самом деле. null — касса не сказала, не сверяем. */
  amount: number | null;
  currency: string | null;
  raw?: unknown;
};

/**
 * Платёж подтверждён кассой: открыть доступ и отправить ссылку. Повторный
 * вебхук того же платежа ничего не продлевает и второго письма не шлёт.
 * false — платёж не наш или сумма не та; это пишем в лог, доступ не даём.
 */
export async function fulfil(p: Paid): Promise<{ ok: boolean; accessId?: string; duplicate?: boolean }> {
  const checkout = p.checkoutId ? await checkoutById(p.checkoutId) : null;
  if (p.checkoutId && !checkout) {
    console.error(`course ${p.provider}: начатая оплата ${p.checkoutId} не найдена`);
    return { ok: false };
  }
  if (checkout && checkout.provider !== p.provider) {
    console.error(`course ${p.provider}: оплата ${checkout.id} начата в ${checkout.provider}`);
    return { ok: false };
  }
  if (checkout && p.amount !== null && Math.abs(p.amount - Number(checkout.amount)) > 0.01) {
    console.error(`course ${p.provider}: сумма разошлась`, p.amount, checkout.amount);
    return { ok: false };
  }

  const slug = checkout?.slug ?? p.slug;
  const email = checkout?.email ?? p.email;
  if (!slug || !email) {
    console.error(`course ${p.provider}: не понять, какой курс и чья почта`, p.providerId);
    return { ok: false };
  }

  const grant = await grantAccess({
    slug,
    email,
    name: checkout?.name ?? p.name ?? null,
    source: 'purchase',
    order: {
      provider: p.provider,
      providerId: p.providerId,
      amount: p.amount ?? (checkout ? Number(checkout.amount) : null),
      currency: p.currency ?? checkout?.currency ?? null,
      checkoutId: checkout?.id ?? null,
      raw: p.raw,
    },
  });
  if (grant.duplicate) return { ok: true, accessId: grant.accessId, duplicate: true };

  if (checkout) await query('update course_checkouts set paid_at = now() where id = $1', [checkout.id]);
  const sent = await sendLink(grant.accessId);
  if (!sent) console.error(`course ${p.provider}: доступ открыт, но письмо не ушло`, email);
  console.log(`course ${p.provider}: доступ открыт`, slug, email);
  return { ok: true, accessId: grant.accessId, duplicate: false };
}

/**
 * Квитанция iCount за оплату через PayPlus. Выписывается один раз: iCount
 * сам отбивает повтор по id начатой оплаты, а мы ещё и помним ссылку.
 * Ошибку не бросаем — доступ уже открыт, а квитанцию можно добить потом.
 */
export async function issueCourseReceipt(providerId: string, card: Card | null): Promise<void> {
  if (!receiptsReady()) return;
  const row = await one<{
    order_id: string; checkout_id: string | null; access_id: string; email: string; name: string | null;
    slug: string; amount: string; currency: string; receipt_url: string | null;
  }>(
    `select o.id as order_id, o.checkout_id, o.access_id, a.email, a.name, c.slug,
            o.amount::text, o.currency, o.receipt_url
       from course_orders o
       join course_access a on a.id = o.access_id
       join courses c on c.id = a.course_id
      where o.provider = 'payplus' and o.provider_id = $1`,
    [providerId],
  );
  if (!row || row.receipt_url) return;
  const offer = OFFERS[row.slug];
  try {
    const receipt = await createReceipt({
      paymentId: row.checkout_id ?? row.order_id,
      userId: row.access_id,
      customerName: row.name || row.email,
      email: row.email,
      items: [{ description: offer?.item ?? 'Видеокурс', quantity: 1, price: Number(row.amount) }],
      amount: Number(row.amount),
      currency: row.currency,
      method: 'cc',
      card,
    });
    await query('update course_orders set receipt_url = $2, receipt_error = null where id = $1',
      [row.order_id, receipt.url ?? 'выписана']);
  } catch (err) {
    if (err instanceof ICountError && err.reason === ALREADY_ISSUED) {
      await query(`update course_orders set receipt_url = 'выписана', receipt_error = null where id = $1`, [row.order_id]);
      return;
    }
    console.error('course: квитанция не выписана', err);
    await query('update course_orders set receipt_error = $2 where id = $1',
      [row.order_id, err instanceof Error ? err.message.slice(0, 300) : 'не выписана']);
  }
}

// ── Polar ─────────────────────────────────────────────────

/**
 * Подпись вебхука Polar по стандарту Standard Webhooks: HMAC-SHA256 от
 * «id.время.тело», ключ — сам секрет в байтах. Старше пяти минут не
 * принимаем, чтобы перехваченный вызов нельзя было повторить.
 */
export function polarSignatureOk(raw: string, headers: Headers): boolean {
  const secret = process.env.POLAR_WEBHOOK_SECRET?.trim();
  const id = headers.get('webhook-id');
  const ts = headers.get('webhook-timestamp');
  const sig = headers.get('webhook-signature');
  if (!secret || !id || !ts || !sig) return false;
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 5 * 60) return false;

  const keys = [Buffer.from(secret, 'utf8')];
  if (secret.startsWith('whsec_')) keys.push(Buffer.from(secret.slice(6), 'base64'));
  const given = sig.split(' ').map((part) => part.split(',')).filter(([v]) => v === 'v1').map(([, s]) => s ?? '');

  return keys.some((key) => {
    const expected = Buffer.from(createHmac('sha256', key).update(`${id}.${ts}.${raw}`).digest('base64'));
    return given.some((s) => {
      const b = Buffer.from(s);
      return b.length === expected.length && timingSafeEqual(b, expected);
    });
  });
}

/** Заказ Polar относится к курсу: по metadata из нашей формы или по товару. */
export function polarCourse(order: { metadata?: Record<string, unknown>; product_id?: string; product?: { id?: string } }):
  { slug: string; checkoutId: string | null } | null {
  const meta = order.metadata ?? {};
  if (typeof meta.course === 'string' && OFFERS[meta.course]) {
    return { slug: meta.course, checkoutId: typeof meta.checkout === 'string' ? meta.checkout : null };
  }
  const product = order.product_id ?? order.product?.id;
  for (const [slug, offer] of Object.entries(OFFERS)) {
    if (offer.polarProduct && offer.polarProduct === product) return { slug, checkoutId: null };
  }
  return null;
}

// ── ЮKassa ────────────────────────────────────────────────

type YooPayment = {
  id?: string;
  status?: string;
  paid?: boolean;
  amount?: { value?: string; currency?: string };
  metadata?: Record<string, string>;
};

/** Платёж ЮKassa, как его видит сама ЮKassa, а не присланный вебхук. */
export async function yookassaPayment(id: string): Promise<YooPayment | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const res = await fetch(`https://api.yookassa.ru/v3/payments/${id}`, {
    headers: { Authorization: yookassaAuth() },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`ЮKassa ${res.status}`);
  return (await res.json()) as YooPayment;
}
