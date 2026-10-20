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

/** Читает быстрая модель: чек — не литература, а сумма и дата. */
const MODEL = 'claude-haiku-4-5-20251001';

/** Ответ ждём недолго: человек стоит с телефоном над чеком. */
const TIMEOUT_MS = 30_000;

export function isConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export type Scanned = {
  /** Название лавки так, как оно написано на чеке. */
  supplier: string | null;
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
};

const PROMPT = `Ты разбираешь фотографию израильского чека или счёта поставщика.

Верни ТОЛЬКО JSON без пояснений и без markdown, с полями:
{
  "supplier": "название лавки как на чеке",
  "supplier_vat": "ח.פ / ע.מ, только цифры",
  "doc_type": "invoice | invrec | receipt | other",
  "doc_number": "номер документа",
  "spent_on": "ГГГГ-ММ-ДД",
  "amount": число, итого к оплате с НДС,
  "vat": число, сумма НДС,
  "currency": "ILS",
  "paid_by": "card | cash | transfer | null",
  "what": "одной короткой фразой по-русски, что купили"
}

Правила:
- חשבונית מס = invoice, חשבונית מס קבלה = invrec, קבלה = receipt.
- Дату бери из чека, а не сегодняшнюю. Израильский формат ДД/ММ/ГГГГ.
- amount — строка לתשלום или סה"כ, то есть итог с НДС.
- Чего не видно или не уверен — ставь null. Не угадывай.`;

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
        max_tokens: 1000,
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
        supplier: str(got.supplier),
        supplier_vat: str(got.supplier_vat)?.replace(/\D/g, '') || null,
        doc_type: str(got.doc_type),
        doc_number: str(got.doc_number),
        spent_on: /^\d{4}-\d{2}-\d{2}$/.test(String(got.spent_on)) ? String(got.spent_on) : null,
        amount: num(got.amount),
        vat: num(got.vat),
        currency: str(got.currency) ?? 'ILS',
        paid_by: str(got.paid_by),
        what: str(got.what),
      },
    };
  } catch {
    return { ok: false, error: `разбор не вышел: ${body.slice(0, 120)}` };
  }
}

function str(v: unknown): string | null {
  const s = typeof v === 'string' ? v.trim() : '';
  return s && s !== 'null' ? s : null;
}

function num(v: unknown): number | null {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) && n !== 0 ? n : null;
}
