/**
 * PayPlus. Две операции: создать платёжную страницу и проверить транзакцию.
 *
 * Обратному вызову мы не верим на слово. Подпись у него есть, заголовок
 * hash считается от тела на секретном ключе, но проще и надёжнее после
 * каждого уведомления самим спросить у PayPlus, что произошло на самом
 * деле, через /PaymentPages/ipn. Оттуда же берём данные для квитанции.
 */

import type { Card } from './icount';

const BASE = {
  test: 'https://restapidev.payplus.co.il/api/v1.0',
  prod: 'https://restapi.payplus.co.il/api/v1.0',
};

function env() {
  const mode = process.env.PAYPLUS_ENV === 'prod' ? 'prod' : 'test';
  // Ключи часто копируют с переносом строки или пробелом на конце,
  // а PayPlus на это отвечает тем же 403, что и на чужой ключ.
  const clean = (v: string | undefined) => (v ?? '').trim();
  return {
    mode,
    base: BASE[mode],
    apiKey: clean(process.env.PAYPLUS_API_KEY),
    secretKey: clean(process.env.PAYPLUS_SECRET_KEY),
    pageUid: clean(process.env.PAYPLUS_PAGE_UID),
    chargeDefault: clean(process.env.PAYPLUS_CHARGE_DEFAULT),
  };
}

export function isConfigured(): boolean {
  const e = env();
  return Boolean(e.apiKey && e.secretKey && e.pageUid);
}

async function call<T>(path: string, body: unknown): Promise<T> {
  const e = env();
  const res = await fetch(`${e.base}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'api-key': e.apiKey,
      'secret-key': e.secretKey,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    // Шлюз PayPlus отвечает текстом, когда запрос отбит до метода.
    const where = new URL(e.base).host;
    const hint = text.includes('not-authorize')
      ? ' Похоже, API не разрешён для этого терминала, либо ключи и платёжная страница от разных терминалов.'
      : '';
    throw new Error(`${res.status} «${text.trim().slice(0, 120)}» от ${where}.${hint}`);
  }
  if (!res.ok) {
    const hint = res.status === 403
      ? ` Ключи не подходят к среде «${e.mode}»: у тестовой и боевой они разные, как и идентификатор страницы.`
      : '';
    throw new Error(`${res.status} ${text.slice(0, 200)}.${hint}`);
  }
  return data as T;
}

export type PaymentLink = { pageRequestUid: string; url: string };

export type LinkInput = {
  amount: number;
  currency: string;
  customerName: string;
  email: string;
  description: string;
  /** Наш идентификатор платежа: возвращается в обратном вызове. */
  reference: string;
  successUrl: string;
  failureUrl: string;
  callbackUrl: string;
};

export async function createPaymentLink(input: LinkInput): Promise<PaymentLink> {
  const e = env();
  const data = await call<{
    results?: { status?: string; description?: string };
    data?: { page_request_uid?: string; payment_page_link?: string };
  }>('/PaymentPages/generateLink', {
    payment_page_uid: e.pageUid,
    // Какой способ предложить первым. Остальные включённые на терминале
    // всё равно останутся на странице.
    ...(e.chargeDefault ? { charge_default: e.chargeDefault } : {}),
    amount: input.amount,
    currency_code: input.currency,
    sendEmailApproval: true,
    sendEmailFailure: false,
    customer: { customer_name: input.customerName, email: input.email },
    items: [{ name: input.description, quantity: 1, price: input.amount }],
    refURL_success: input.successUrl,
    refURL_failure: input.failureUrl,
    refURL_callback: input.callbackUrl,
    more_info: input.reference,
  });

  const uid = data.data?.page_request_uid;
  const url = data.data?.payment_page_link;
  if (!uid || !url) {
    throw new Error(data.results?.description ?? 'ссылка не создана, PayPlus не объяснил причину');
  }
  return { pageRequestUid: uid, url };
}

export type TransactionCheck = {
  paid: boolean;
  statusCode: string | null;
  amount: number | null;
  transactionUid: string | null;
  reference: string | null;
  /** Хвост карты и номер подтверждения: нужны только для квитанции. */
  card: Card | null;
};

/** Спрашиваем у PayPlus, что на самом деле случилось с платежом. */
export async function fetchTransaction(params: {
  pageRequestUid?: string;
  transactionUid?: string;
}): Promise<TransactionCheck> {
  // PayPlus называет этот идентификатор по-разному в разных местах
  // документации, поэтому кладём под обоими именами: лишнее он игнорирует.
  const body: Record<string, string> = {};
  if (params.pageRequestUid) {
    body.payment_request_uid = params.pageRequestUid;
    body.page_request_uid = params.pageRequestUid;
  }
  if (params.transactionUid) body.transaction_uid = params.transactionUid;

  const raw = await call<Record<string, unknown>>('/PaymentPages/ipn', body);

  // Форма ответа у PayPlus плавает. На проверку он отвечает плоским
  // объектом внутри data, а в обратном вызове те же поля разложены по
  // transaction и card_information, да ещё и названы иначе. Поэтому
  // складываем все места в стопку и ищем ключ по всей стопке сразу.
  const holder = obj(raw.data ?? raw);
  const tx = obj(holder.transaction ?? holder);
  const where = [tx, holder, obj(tx.card_information ?? holder.card_information), obj(tx.payments)];

  const statusCode = text(where, 'status_code');
  const amount = number(where, 'amount');

  const card: Card = {
    fourDigits: text(where, 'four_digits'),
    brand: text(where, 'brand_name'),
    approvalNumber: text(where, 'approval_num', 'approval_number', 'voucher_num', 'voucher_number'),
    payments: number(where, 'number_of_payments'),
  };

  return {
    paid: statusCode === '000',
    statusCode,
    amount,
    transactionUid: text(where, 'transaction_uid', 'uid'),
    reference: text(where, 'more_info'),
    // Без хвоста карты квитанция всё равно законна, поэтому пусто — не беда.
    card: Object.values(card).some((v) => v !== null) ? card : null,
  };
}

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
}

/** Первое непустое значение ключа по всем местам, где PayPlus его прячет. */
function text(where: Record<string, unknown>[], ...keys: string[]): string | null {
  for (const key of keys) {
    for (const place of where) {
      const v = place[key];
      if (typeof v === 'string' && v.trim()) return v.trim();
      if (typeof v === 'number') return String(v);
    }
  }
  return null;
}

function number(where: Record<string, unknown>[], ...keys: string[]): number | null {
  const found = Number(text(where, ...keys));
  return Number.isFinite(found) ? found : null;
}

