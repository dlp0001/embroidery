import { createHmac } from 'node:crypto';

/**
 * Подпись ссылок на зону Bunny CDN (Token Authentication, вариант HS256).
 * Повторяет официальную реализацию BunnyWay/BunnyCDN.TokenAuthentication:
 * HMAC-SHA256 на ключе зоны от «путь подписи + срок + параметры по
 * алфавиту», результат в base64url без «=», с приставкой HS256-.
 *
 * Для потокового видео подпись кладётся в путь (bcdn_token=…/папка/файл)
 * и покрывает всю папку видео: плеер запрашивает куски по относительным
 * адресам, и они наследуют подпись сами.
 */

function token(key: string, signaturePath: string, expires: string, signingData: string): string {
  const digest = createHmac('sha256', key)
    .update(signaturePath)
    .update(expires)
    .update(signingData)
    .digest('base64');
  return 'HS256-' + digest.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Подпись одного файла: …/file?token=…&expires=… (нужна для сверки с примерами Bunny). */
export function signFile(url: string, key: string, expires: number, pathAllowed = ''): string {
  const u = new URL(url);
  const params: [string, string][] = pathAllowed ? [['token_path', pathAllowed]] : [];
  const signing = params.map(([k, v]) => `${k}=${v}`).join('&');
  const urlData = params.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  const t = token(key, pathAllowed || u.pathname, String(expires), signing);
  return `${u.protocol}//${u.host}${u.pathname}?token=${t}${urlData ? `&${urlData}` : ''}&expires=${expires}`;
}

/**
 * Ссылка с подписью на папку: https://зона/bcdn_token=…&token_path=%2Fпапка%2F&expires=…/папка/файл.
 * dir — папка с ведущим и замыкающим «/», file — путь внутри неё.
 */
export function signDirectory(host: string, dir: string, file: string, key: string, expires: number): string {
  const t = token(key, dir, String(expires), `token_path=${dir}`);
  return `https://${host}/bcdn_token=${t}&token_path=${encodeURIComponent(dir)}&expires=${expires}${dir}${file}`;
}
