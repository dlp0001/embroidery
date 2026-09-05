// Локальный предпросмотр сайта. Повторяет поведение Vercel из vercel.json:
// cleanUrls (/embroidery -> embroidery.html) и редирект /?success=true.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const root = process.cwd();
const port = Number(process.env.PORT) || 4321;

const types = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.png': 'image/png', '.webp': 'image/webp', '.ico': 'image/x-icon',
};

async function resolve(pathname) {
  const safe = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, '');
  const candidates = safe === '/' ? ['index.html'] : [safe.slice(1), safe.slice(1) + '.html', join(safe.slice(1), 'index.html')];
  for (const c of candidates) {
    const full = join(root, c);
    try {
      const s = await stat(full);
      if (s.isFile()) return full;
    } catch {}
  }
  return null;
}

createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);

  if (url.pathname === '/' && url.searchParams.has('success')) {
    res.writeHead(308, { Location: '/embroidery?success=true' });
    return res.end();
  }

  const file = await resolve(url.pathname);
  if (!file) {
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end('<p style="font:300 16px Jost,sans-serif;padding:40px">404 — ' + url.pathname + '</p>');
  }

  res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream' });
  res.end(await readFile(file));
}).listen(port, () => console.log(`preview on http://localhost:${port}`));
