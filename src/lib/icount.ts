/**
 * iCount. Одна операция: выписать родителю квитанцию на прошедший платёж.
 *
 * Документ выписывается ровно один раз, даже если вебхук придёт дважды:
 * iCount отбивает повтор сам, по sanity_string. Поэтому звать можно
 * сколько угодно, и это единственная защита, на которую мы полагаемся.
 */

const BASE = 'https://api.icount.co.il/api/v3.php';

function env() {
  // Токен часто копируют с переносом строки: iCount на это отвечает
  // тем же отказом, что и на чужой токен.
  const clean = (v: string | undefined) => (v ?? '').trim();
  return {
    token: clean(process.env.ICOUNT_TOKEN),
    // Варя — осек патур: она выписывает квитанцию, а не налоговый счёт.
    doctype: clean(process.env.ICOUNT_DOCTYPE) || 'receipt',
    // Язык документа. Пусто — берётся тот, что стоит в самом iCount.
    lang: clean(process.env.ICOUNT_DOC_LANG),
  };
}

export function isConfigured(): boolean {
  return Boolean(env().token);
}

/** Причина отказа нужна вызывающему: по ней он отличает повтор от поломки. */
export class ICountError extends Error {
  constructor(readonly reason: string, description: string) {
    super(`${reason}: ${description}`);
    this.name = 'ICountError';
  }
}

/** Так iCount отвечает, когда документ с таким sanity_string уже выписан. */
export const ALREADY_ISSUED = 'doc_exists_based_on_sanity_string';

type Answer = { status?: boolean; reason?: string; error_description?: string };

async function call<T>(method: string, body: Record<string, unknown>): Promise<T & Answer> {
  const res = await fetch(`${BASE}/${method}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env().token}`,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data: (T & Answer) | null = null;
  try {
    data = JSON.parse(text) as T & Answer;
  } catch {
    throw new ICountError(String(res.status), `не JSON: «${text.trim().slice(0, 120)}»`);
  }
  // Отказ приходит с кодом 200 и status: false, так что проверяем и то и другое.
  if (!res.ok || data.status === false) {
    throw new ICountError(
      data.reason ?? String(res.status),
      data.error_description ?? text.slice(0, 200),
    );
  }
  return data;
}

/** Чем заплатили: карта на кассе PayPlus или деньги напрямую студии. */
export type Method = 'cc' | 'cash';

export type Card = {
  fourDigits: string | null;
  brand: string | null;
  approvalNumber: string | null;
  payments: number | null;
};

export type ReceiptInput = {
  /** Наш идентификатор платежа: по нему iCount и отбивает повторную выписку. */
  paymentId: string;
  /** Наш идентификатор родителя: постоянный клиент не размножается в iCount. */
  userId: string;
  customerName: string;
  email: string;
  description: string;
  amount: number;
  currency: string;
  method: Method;
  card?: Card | null;
};

export type Receipt = { docnum: number | null; url: string | null };

/** iCount принимает не длиннее тридцати знаков, а uuid длиннее. */
function sanity(paymentId: string): string {
  return paymentId.replace(/-/g, '').slice(0, 30);
}

export async function createReceipt(input: ReceiptInput): Promise<Receipt> {
  const e = env();
  const paid = {
    sum: input.amount,
    num_of_payments: input.card?.payments ?? 1,
    ...(input.card?.brand ? { card_type: input.card.brand } : {}),
    ...(input.card?.fourDigits ? { card_number: input.card.fourDigits } : {}),
    ...(input.card?.approvalNumber ? { confirmation_code: input.card.approvalNumber } : {}),
  };

  const data = await call<{ docnum?: number | string; doc_url?: string }>('doc/create', {
    doctype: e.doctype,
    custom_client_id: input.userId,
    client_name: input.customerName,
    email: input.email,
    currency_code: input.currency,
    ...(e.lang ? { doc_lang: e.lang } : {}),
    items: [{
      description: input.description,
      // Цена всегда та, что заплатил родитель. У осек патур НДС нулевой,
      // а если студия однажды перестанет им быть, iCount вычтет налог сам.
      unitprice_incvat: input.amount,
      quantity: 1,
    }],
    ...(input.method === 'cc' ? { cc: paid } : { cash: { sum: input.amount } }),
    // Письмо с квитанцией отправляет сам iCount: своей рассылки у нас нет.
    send_email: true,
    sanity_string: sanity(input.paymentId),
  });

  const docnum = Number(data.docnum);
  return {
    docnum: Number.isFinite(docnum) ? docnum : null,
    url: typeof data.doc_url === 'string' ? data.doc_url : null,
  };
}
