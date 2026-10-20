/**
 * Чтение чека с фотографии.
 *
 * Снимок уходит в Claude, оттуда возвращаются поля: поставщик, его номер
 * в реестре, тип и номер документа, дата, сумма и НДС. Дальше их смотрит
 * человек — поэтому модели разрешено отвечать «не знаю» пустым полем, и
 * это честнее, чем выдуманная цифра: пустое поле на экране заметно, а
 * правдоподобная ошибка нет.
 */

const API = 'https://api.anthropic.com/v1/messages';

/**
 * Чем читаем. Чек — не литература, но и не печатный текст: мятая
 * термобумага, иврит и снимок под углом. Модель задаётся настройкой,
 * чтобы менять её, не трогая код.
 */
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5';

/**
 * Сколько ждём. Чек на три десятка строк модель разбирает полминуты и
 * дольше, а весь вызов у нас живёт минуту — поэтому ждём сорок пять
 * секунд и оставляем пятнадцать на запись и ответ в телеграм.
 */
const TIMEOUT_MS = 45_000;

export function isConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export type Scanned = {
  /** Юридическое лицо: оно идёт в бухгалтерию. */
  supplier: string | null;
  /** Вывеска магазина. Человек помнит её, а фирму — никогда. */
  trade_name: string | null;
  /** ח.פ или ע.מ — номер в израильском реестре, если он напечатан. */
  supplier_vat: string | null;
  /** Тип документа глазами iCount: invoice, invrec, receipt, other. */
  doc_type: string | null;
  doc_number: string | null;
  /** ГГГГ-ММ-ДД. */
  spent_on: string | null;
  /** Итого к оплате, с НДС. */
  amount: number | null;
  /** Сам НДС, если он выделен строкой. */
  vat: number | null;
  currency: string;
  /** Чем расплатились: card, cash, transfer — по тому, что видно на чеке. */
  paid_by: string | null;
  /** Одной строкой: что купили. Нужно, чтобы выбрать группу затрат. */
  what: string | null;
  /** Строки чека целиком: по ним потом собираются отчёты. */
  items: Item[];
};

/**
 * Строка чека. Группа — догадка модели, а не решение человека: она
 * нужна, чтобы прикинуть, сколько из похода в магазин было материалами,
 * а сколько едой.
 */
export type Item = {
  sku: string | null;
  name: string;
  qty: number | null;
  price: number | null;
  sum: number | null;
  kind: Guess;
};

/**
 * Постоянные имена групп. Модель говорит на них, а не на названиях наших
 * статей: статьи переименовывают, и разбор ломался бы каждый раз.
 */
export const GUESSES = ['materials', 'stationery', 'equipment', 'food', 'other'] as const;
export type Guess = (typeof GUESSES)[number];

const PROMPT = `Ты разбираешь фотографию израильского чека или счёта поставщика.

Верни ТОЛЬКО JSON без пояснений и без markdown, с полями:
{
  "supplier": "юридическое лицо с ח.פ",
  "trade_name": "вывеска магазина, если она отдельной строкой",
  "supplier_vat": "ח.פ / ע.מ, только цифры",
  "doc_type": "invoice | invrec | receipt | other",
  "doc_number": "номер документа",
  "spent_on": "ГГГГ-ММ-ДД",
  "amount": число, итого к оплате с НДС,
  "vat": число, сумма НДС,
  "currency": "ILS",
  "paid_by": "card | cash | transfer | null",
  "what": "одной короткой фразой по-русски, что купили",
  "items": [
    {
      "sku": "артикул или штрихкод, как напечатан",
      "name": "название позиции как на чеке",
      "qty": число или null,
      "price": цена за штуку или null,
      "sum": сумма строки,
      "kind": "materials | stationery | equipment | food | other"
    }
  ]
}

Правила:
- На чеке часто две шапки: вывеска магазина и фирма с ח.פ. В supplier
  пиши фирму, в trade_name — вывеску. Одна шапка — trade_name оставь null.
- חשבונית מס = invoice, חשבונית מס קבלה = invrec, קבלה = receipt.
- Дату бери из чека, а не сегодняшнюю. Израильский формат ДД/ММ/ГГГГ.
- amount — строка לתשלום или סה"כ, то есть итог с НДС.
- Чего не видно или не уверен — ставь null. Не угадывай.
- items: перечисли ВСЕ строки чека, по одной, в порядке печати. Название
  оставляй как на чеке, не переводи.
- kind на строке: materials — краски, бумага, холсты, кисти, ткань,
  фурнитура, всё, из чего делают работы; stationery — ручки, скрепки,
  файлы, картриджи, бытовая мелочь для студии; equipment — инструменты,
  техника, мебель; food — еда и напитки; other — что не подошло.`;

type Answer = { content?: { type?: string; text?: string }[] };

/**
 * Разбирает снимок. Ошибку наружу не бросаем: чек всё равно сохранится, а
 * поля человек заполнит руками — потерять фотографию хуже, чем не
 * прочитать её.
 */
export async function readReceipt(
  image: Buffer, mime = 'image/jpeg',
): Promise<{ ok: true; data: Scanned } | { ok: false; error: string }> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { ok: false, error: 'ключ к модели не задан' };

  let res: Response;
  try {
    res = await fetch(API, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        // Чек на тридцать строк в тысячу токенов не влезает, а обрезанный
        // ответ — это не ошибка модели, а наша: она честно начала писать.
        max_tokens: 8000,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mime, data: image.toString('base64') } },
            { type: 'text', text: PROMPT },
          ],
        }],
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    const why = err instanceof Error && err.name === 'TimeoutError'
      ? `модель не ответила за ${TIMEOUT_MS / 1000} с`
      : err instanceof Error ? err.message : 'запрос не прошёл';
    return { ok: false, error: why };
  }

  const text = await res.text();
  if (!res.ok) return { ok: false, error: `${res.status}: ${text.slice(0, 200)}` };

  let said = '';
  try {
    const data = JSON.parse(text) as Answer;
    said = (data.content ?? []).filter((c) => c.type === 'text').map((c) => c.text ?? '').join('');
  } catch {
    return { ok: false, error: `ответ не JSON: ${text.slice(0, 120)}` };
  }

  // Модель иногда оборачивает JSON в ```json: вынимаем то, что внутри.
  const body = said.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
  try {
    const got = JSON.parse(body) as Partial<Scanned>;
    return {
      ok: true,
      data: {
        supplier: firm(str(got.supplier)),
        trade_name: str(got.trade_name),
        supplier_vat: str(got.supplier_vat)?.replace(/\D/g, '') || null,
        doc_type: str(got.doc_type),
        doc_number: str(got.doc_number),
        spent_on: /^\d{4}-\d{2}-\d{2}$/.test(String(got.spent_on)) ? String(got.spent_on) : null,
        amount: num(got.amount),
        vat: num(got.vat),
        currency: str(got.currency) ?? 'ILS',
        paid_by: str(got.paid_by),
        what: str(got.what),
        items: items(got.items),
      },
    };
  } catch {
    return { ok: false, error: `разбор не вышел: ${body.slice(0, 120)}` };
  }
}

/** Строки чека: пустые и безымянные отбрасываем, остальное приводим к виду. */
function items(v: unknown): Item[] {
  if (!Array.isArray(v)) return [];
  const out: Item[] = [];
  for (const row of v) {
    const r = row as Record<string, unknown>;
    const name = str(r.name);
    if (!name) continue;
    const kind = str(r.kind);
    out.push({
      sku: str(r.sku),
      name,
      qty: num(r.qty),
      price: num(r.price),
      sum: num(r.sum),
      kind: (GUESSES as readonly string[]).includes(kind ?? '') ? (kind as Guess) : 'other',
    });
  }
  return out;
}

/**
 * Имя фирмы без номера в реестре. Модель иногда приклеивает «ח.פ
 * 515148286» к названию — на чеке они стоят рядом, — а в справочник
 * поставщиков такое имя попасть не должно: номер у него своё поле.
 */
function firm(name: string | null): string | null {
  if (!name) return null;
  const clean = name
    .replace(/[,\s]*(?:ח\.?\s?פ|ע\.?\s?מ|ח\.?\s?צ)\.?\s*[:]?\s*\d[\d-]{6,}\s*$/u, '')
    .trim();
  return clean || name;
}

function str(v: unknown): string | null {
  const s = typeof v === 'string' ? v.trim() : '';
  return s && s !== 'null' ? s : null;
}

function num(v: unknown): number | null {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) && n !== 0 ? n : null;
}

/**
 * Перевод названий. Отдельный вызов и нарочно дешёвый: здесь нет
 * картинки, а значит, и той цены, которую стоит чтение чека. Берём
 * быструю модель — перевести «מארז קנבסים» на русский ей по силам.
 */
const WORDS_MODEL = process.env.ANTHROPIC_WORDS_MODEL || 'claude-haiku-4-5-20251001';

export type Words = {
  /** Вывеска магазина латиницей: «Mini Max». */
  shop: string | null;
  /** Названия строк по-русски, в том же порядке, что пришли. */
  items: (string | null)[];
};

export async function translate(
  shop: string | null, items: string[],
): Promise<Words | null> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key || (!shop && items.length === 0)) return null;

  const ask = [
    'Переведи для русского читателя то, что напечатано на израильском чеке.',
    '',
    shop ? `Вывеска магазина: ${shop}` : '',
    items.length ? `Строки чека:\n${items.map((n, i) => `${i + 1}. ${n}`).join('\n')}` : '',
    '',
    'Верни ТОЛЬКО JSON: {"shop": "вывеска латиницей, как её пишут сами владельцы",',
    '"items": ["русское название строки 1", ...]}',
    '',
    'Вывеску передай латиницей буква в букву — это транслитерация, а не',
    'перевод: «מיני מקס» → «Mini Max». Улицы и города не досочиняй; если',
    'часть неразборчива, опусти её.',
    'Строк в items должно быть ровно столько же и в том же порядке.',
    'Названия товаров переводи коротко и по делу: «набор холстов 30×40»,',
    '«батарейки AA». Чего не понял — ставь null.',
  ].filter(Boolean).join('\n');

  try {
    const res = await fetch(API, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: WORDS_MODEL,
        max_tokens: 4000,
        messages: [{ role: 'user', content: ask }],
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Answer;
    const said = (data.content ?? []).filter((c) => c.type === 'text')
      .map((c) => c.text ?? '').join('').trim()
      .replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
    const got = JSON.parse(said) as { shop?: unknown; items?: unknown };
    const list = Array.isArray(got.items) ? got.items : [];
    return {
      shop: str(got.shop),
      // Длина должна совпасть со списком, иначе перевод не на свои места.
      items: items.map((_, i) => str(list[i])),
    };
  } catch {
    return null;
  }
}
