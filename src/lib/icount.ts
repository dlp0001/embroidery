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

/** Каким документом закрываются платежи. Не секрет, показывается в здоровье. */
export function doctype(): string {
  return env().doctype;
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

/**
 * Сколько ждём ответа. Без срока запрос висит, пока его не оборвёт сам
 * хостинг, а вместе с ним висит и то, ради чего его позвали: журнал
 * сохранён, а кнопка крутится.
 */
const TIMEOUT_MS = 12_000;

async function call<T>(method: string, body: Record<string, unknown>): Promise<T & Answer> {
  let res: Response;
  try {
    res = await fetch(`${BASE}/${method}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env().token}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    // Обрыв по сроку — такой же отказ, как и любой другой: платёж
    // остаётся без квитанции, и следующая попытка её добьёт.
    const why = err instanceof Error && err.name === 'TimeoutError'
      ? `не ответил за ${TIMEOUT_MS / 1000} с`
      : err instanceof Error ? err.message : 'запрос не прошёл';
    throw new ICountError('network', why);
  }
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

/**
 * Чем заплатили: карта на кассе PayPlus, наличные или платёжное
 * приложение. Приложение налоговая просит указывать отдельно от наличных,
 * поэтому Bit и PayBox идут своим блоком, а не как деньги в кассу.
 */
export type Method = 'cc' | 'cash' | 'app' | 'transfer';

/** Какое именно приложение. Значения — коды iCount, не наши выдумки. */
export type PayApp = 'bit' | 'paybox';

/**
 * Приложения идут не своим блоком, а через общий payments: ключ — код
 * способа оплаты из payment_method/get_list, а какое именно приложение,
 * кладётся в card_brand. Коды взяты у самого iCount, посмотреть их можно
 * командой npm run icount:methods.
 */
const APP_METHOD = 'payment_app';

export type Card = {
  fourDigits: string | null;
  brand: string | null;
  approvalNumber: string | null;
  payments: number | null;
};

/** Цена за штуку, вместе с налогом, если он когда-нибудь появится. */
export type ReceiptItem = { description: string; quantity: number; price: number };

export type ReceiptInput = {
  /** Наш идентификатор платежа: по нему iCount и отбивает повторную выписку. */
  paymentId: string;
  /** Наш идентификатор родителя: постоянный клиент не размножается в iCount. */
  userId: string;
  customerName: string;
  email: string;
  items: ReceiptItem[];
  /** Что списала касса. Может не совпасть с суммой позиций только из-за скидки. */
  amount: number;
  currency: string;
  method: Method;
  card?: Card | null;
  /** Только для method: 'app'. */
  app?: PayApp | null;
  /**
   * Только для method: 'transfer'. Банковский перевод iCount принимает
   * своим блоком и требует, на какой счёт компании деньги пришли.
   */
  transfer?: { account: number; date: string } | null;
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
    // Цена идёт та, что заплатил родитель. У осек патур НДС нулевой,
    // а если студия однажды перестанет им быть, iCount вычтет налог сам.
    items: input.items.map((i) => ({
      description: i.description,
      unitprice_incvat: i.price,
      quantity: i.quantity,
    })),
    ...(input.method === 'cc' ? { cc: paid }
      : input.method === 'app'
        ? {
            payments: {
              [APP_METHOD]: { sum: input.amount, card_brand: input.app ?? 'bit' },
            },
          }
      : input.method === 'transfer' && input.transfer
        ? {
            banktransfer: {
              sum: input.amount,
              date: input.transfer.date,
              account: input.transfer.account,
            },
          }
        : { cash: { sum: input.amount } }),
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

// ── Расходы ───────────────────────────────────────────────

export type Supplier = {
  supplier_id: string;
  supplier_name: string;
  /** ח.פ: по нему узнаём лавку вернее, чем по написанию названия. */
  vat_id: string;
};

/** Поставщики, заведённые в бухгалтерии. Их немного, берём списком целиком. */
export async function suppliers(): Promise<Supplier[]> {
  const data = await call<{ suppliers?: Record<string, Supplier> }>('supplier/get_list', {});
  return Object.values(data.suppliers ?? {});
}

/**
 * Заводит поставщика. Зовём, только когда в списке его не нашлось: лавок
 * у студии немного, и список сам сойдётся за пару месяцев.
 */
export async function addSupplier(name: string, vatId?: string | null): Promise<string | null> {
  const data = await call<{ supplier_id?: number | string }>('supplier/add', {
    supplier_name: name,
    ...(vatId ? { vat_id: vatId } : {}),
  });
  const id = data.supplier_id;
  return id === undefined || id === null ? null : String(id);
}

export type ExpenseInput = {
  supplierId: string;
  /** Вид расхода из справочника iCount: наша группа переводится в него. */
  typeId: number;
  /** invoice, invrec, receipt, other — как на бумаге. */
  docType: string;
  docNumber: string;
  /** Итого с НДС. */
  sum: number;
  /** Сам НДС, если он выделен. */
  vat?: number | null;
  /** Дата документа, она же дата расхода: ГГГГ-ММ-ДД. */
  date: string;
  /** Деньги уже отданы: по чеку из магазина это всегда так. */
  paid?: boolean;
};

/**
 * Заводит расход. Возвращает его номер в iCount — по нему расход потом
 * находится и, если что, удаляется.
 *
 * Дат у расхода три, и все три мы ставим в день покупки: чек из магазина
 * оплачен на месте, и разводить документ, расход и оплату по разным дням
 * значило бы выдумывать то, чего на бумаге нет.
 */
export async function createExpense(input: ExpenseInput): Promise<string | null> {
  const data = await call<{ expense_id?: number | string }>('expense/create', {
    supplier_id: input.supplierId,
    expense_type_id: input.typeId,
    expense_doctype: input.docType,
    expense_docnum: input.docNumber,
    expense_sum: input.sum,
    ...(input.vat ? { expense_vat: input.vat } : {}),
    invoice_date: input.date,
    expense_date: input.date,
    expense_paid_date: input.date,
    expense_paid: input.paid === false ? 0 : 1,
  });
  const id = data.expense_id;
  return id === undefined || id === null ? null : String(id);
}

/** Убирает расход. Нужен, когда провели не то: правим не руками в кабинете. */
export async function dropExpense(id: string): Promise<void> {
  await call('expense/delete', { expense_id: id });
}
