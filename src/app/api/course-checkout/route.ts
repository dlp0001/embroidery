import { startCheckout, type PayMethod } from '@/lib/course-pay';
import { clientIp } from '@/lib/sheets';

export const runtime = 'nodejs';
export const maxDuration = 20;
export const dynamic = 'force-dynamic';

/** Версия текстов согласий на /consent-data и /consent-marketing. */
const CONSENT_VERSION = '1.0';

/** Форма покупки на лендинге: в ответ адрес страницы кассы. */
export async function POST(req: Request) {
  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: 'Пустой запрос' }, { status: 400 });
  }

  const method = String(body.method ?? '') as PayMethod;
  const res = await startCheckout({
    slug: String(body.course ?? 'embroidery'),
    method,
    name: String(body.name ?? ''),
    email: String(body.email ?? ''),
    consents: method === 'ru'
      ? { data: body.consentData === true, marketing: body.consentMarketing === true, version: CONSENT_VERSION }
      : null,
    ip: clientIp(req),
    userAgent: req.headers.get('user-agent'),
  });
  return res.ok ? Response.json({ url: res.url }) : Response.json({ error: res.error }, { status: 400 });
}
