import { query } from './db';
import { getSheet, SHEET_ID } from './sheets';

/**
 * Покупатели первого потока из листа Sheets. Колонки те же, что пишут
 * старые вебхуки: A дата, B имя, C почта, E способ, F статус, H сумма,
 * I валюта. Оплатившие — те, у кого статус начинается с «оплачено»:
 * вебхуки ставят «оплачено ✓», а руками Варя могла написать и без галочки.
 */

export type LegacyBuyer = {
  email: string;
  name: string | null;
  date: string;
  method: string;
  amount: string;
  currency: string;
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
