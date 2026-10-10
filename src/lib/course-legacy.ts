import { one, query } from './db';
import { getSheet, SHEET_ID } from './sheets';

/**
 * Покупатели первого потока из листа Sheets. Колонки те же, что пишут
 * старые вебхуки: A дата, B имя, C почта, E способ, F статус, G id платежа,
 * H сумма, I валюта. Оплатившие — те, у кого статус начинается с «оплачено»:
 * вебхуки ставят «оплачено ✓», а руками Варя могла написать и без галочки.
 */

export type LegacyBuyer = {
  email: string;
  name: string | null;
  date: string;
  method: string;
  amount: string;
  currency: string;
  /** id платежа у кассы, если старый вебхук его записал. */
  paymentId: string;
  /** У этой почты уже есть доступ к курсу — купила заново или выдан руками. */
  hasAccess: boolean;
};

export type LegacySheet = {
  buyers: LegacyBuyer[];
  /** Строки, которые не оплачены, по статусам: видно, что не взяли. */
  skipped: Record<string, number>;
};

export async function legacyBuyers(slug: string): Promise<LegacySheet> {
  const sheets = await getSheet();
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: 'A:I' });
  const rows = (res.data.values ?? []).slice(1);

  const byEmail = new Map<string, LegacyBuyer>();
  const skipped: Record<string, number> = {};
  for (const r of rows) {
    const email = String(r[2] ?? '').trim().toLowerCase();
    const status = String(r[5] ?? '').trim();
    if (!email.includes('@')) continue;
    if (!status.toLowerCase().startsWith('оплачено')) {
      const key = status || 'без статуса';
      skipped[key] = (skipped[key] ?? 0) + 1;
      continue;
    }
    // Первая оплата этой почты: имя и дата оттуда.
    if (!byEmail.has(email)) {
      byEmail.set(email, {
        email,
        name: String(r[1] ?? '').trim() || null,
        date: String(r[0] ?? '').trim(),
        method: String(r[4] ?? '').trim(),
        amount: String(r[7] ?? '').trim(),
        currency: String(r[8] ?? '').trim(),
        paymentId: String(r[6] ?? '').trim(),
        hasAccess: false,
      });
    }
  }

  const emails = [...byEmail.keys()];
  if (emails.length) {
    const have = await query<{ email: string }>(
      `select a.email from course_access a join courses c on c.id = a.course_id
        where c.slug = $1 and a.email = any($2)`,
      [slug, emails],
    );
    for (const h of have) {
      const b = byEmail.get(h.email.toLowerCase());
      if (b) b.hasAccess = true;
    }
  }
  return { buyers: [...byEmail.values()], skipped };
}

// ── Оплата первого потока в базе ──────────────────────────

/** Какая касса: в таблице она записана подписью, а не кодом. */
function providerOf(method: string): string {
  const m = method.toLowerCase();
  if (m.includes('polar')) return 'polar';
  if (m.includes('kassa') || m.includes('касса')) return 'yookassa';
  if (m.includes('paddle')) return 'paddle';
  if (m.includes('lemon')) return 'lemonsqueezy';
  return 'sheet';
}

/** «02.06.2026, 14:05:11» → «2026-06-02». Не разобрали — null. */
function sheetDate(raw: string): string | null {
  const m = raw.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : null;
}

/**
 * Записать оплату из таблицы в course_orders — чтобы в карточке покупателя
 * были касса, сумма и дата, как у новых. id у такой записи свой,
 * «sheet:почта», чтобы не столкнуться с настоящими id касс. Повтор ничего
 * не меняет.
 */
export async function recordLegacyOrder(accessId: string, b: LegacyBuyer): Promise<void> {
  const amount = Number(b.amount.replace(/\s/g, '').replace(',', '.'));
  const paidOn = sheetDate(b.date);
  await query(
    `insert into course_orders (access_id, provider, provider_id, amount, currency, raw, created_at)
     values ($1, $2, $3, $4, $5, $6, coalesce($7::date::timestamptz, now()))
     on conflict (provider, provider_id) do nothing`,
    [
      accessId, providerOf(b.method), `sheet:${b.email}`,
      Number.isFinite(amount) && b.amount ? amount : null,
      b.currency.toUpperCase() || null,
      JSON.stringify({ from: 'sheet', method: b.method, date: b.date, payment_id: b.paymentId || null }),
      paidOn,
    ],
  );
}

/** Сколько перенесённых из таблицы пока без суммы в карточке. */
export async function legacyWithoutOrder(slug: string): Promise<number> {
  const row = await one<{ n: number }>(
    `select count(*)::int as n from course_access a join courses c on c.id = a.course_id
      where c.slug = $1 and a.source = 'legacy'
        and not exists (select 1 from course_orders o where o.access_id = a.id)`,
    [slug],
  );
  return row?.n ?? 0;
}

/** Подтянуть суммы из таблицы тем, кого перенесли без них. Возвращает, скольким. */
export async function backfillLegacyOrders(slug: string): Promise<number> {
  const missing = await query<{ id: string; email: string }>(
    `select a.id, a.email from course_access a join courses c on c.id = a.course_id
      where c.slug = $1 and a.source = 'legacy'
        and not exists (select 1 from course_orders o where o.access_id = a.id)`,
    [slug],
  );
  if (!missing.length) return 0;
  const { buyers } = await legacyBuyers(slug);
  const byEmail = new Map(buyers.map((b) => [b.email, b]));
  let done = 0;
  for (const m of missing) {
    const b = byEmail.get(m.email.toLowerCase());
    if (!b) continue;
    await recordLegacyOrder(m.id, b);
    done++;
  }
  return done;
}
