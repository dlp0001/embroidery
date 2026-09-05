import { google } from 'googleapis';

export const SHEET_ID = process.env.GOOGLE_SHEET_ID;

/** Лист заявок на курс. Остаётся источником правды до этапа отказа от Sheets. */
export async function getSheet() {
  const auth = new google.auth.GoogleAuth({
    credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT ?? '{}'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth });
}

/** Первый IP из цепочки прокси. */
export function clientIp(req: Request): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '';
}
