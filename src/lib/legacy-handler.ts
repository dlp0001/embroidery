/**
 * Мост между обработчиками из api/ и роутами App Router.
 *
 * Вебхуки платёжных провайдеров переписывать вручную опасно: там подпись
 * Lemon Squeezy и живые деньги. Поэтому код обработчиков остался нетронутым
 * в src/server/legacy, а здесь воспроизводится тот запрос и ответ, которые
 * ему давал Vercel: заголовки объектом в нижнем регистре, тело уже разобрано
 * из JSON.
 */

type LegacyRes = {
  status: (code: number) => LegacyRes;
  json: (body: unknown) => LegacyRes;
  send: (body: unknown) => LegacyRes;
  end: (body?: unknown) => LegacyRes;
  setHeader: (name: string, value: string) => LegacyRes;
};

type LegacyHandler = (req: unknown, res: LegacyRes) => unknown;

export async function runLegacy(handler: LegacyHandler, request: Request): Promise<Response> {
  const raw = await request.text();
  let body: unknown = raw;
  if (raw) {
    try {
      body = JSON.parse(raw);
    } catch {
      body = raw;
    }
  }

  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });

  const url = new URL(request.url);
  const req = {
    method: request.method,
    headers,
    body,
    rawBody: raw,
    query: Object.fromEntries(url.searchParams),
    url: url.pathname + url.search,
    socket: { remoteAddress: headers['x-forwarded-for']?.split(',')[0]?.trim() ?? '' },
  };

  let code = 200;
  let payload: unknown = null;
  let sent = false;
  const outHeaders: Record<string, string> = {};

  const res: LegacyRes = {
    status(next) { code = next; return res; },
    json(next) { payload = next; sent = true; return res; },
    send(next) { payload = next; sent = true; return res; },
    end(next) { if (next !== undefined) payload = next; sent = true; return res; },
    setHeader(name, value) { outHeaders[name] = value; return res; },
  };

  await handler(req, res);

  if (!sent) return new Response(null, { status: code, headers: outHeaders });
  if (payload === null || typeof payload === 'object') {
    return Response.json(payload, { status: code, headers: outHeaders });
  }
  return new Response(String(payload), { status: code, headers: outHeaders });
}
