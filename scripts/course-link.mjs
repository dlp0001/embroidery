// Ссылка на курс для одной почты — пока нет страницы в админке.
//
//   npm run course -- anna@example.com            новая ссылка взамен старой
//   npm run course -- anna@example.com --grant    открыть доступ (или продлить) и дать ссылку
//
// Письмо не отправляет: ссылку печатает, её можно переслать руками.
// Старая ссылка после этого перестаёт работать, открытые браузеры остаются.
// На боевую базу: npm run course:prod -- ...

import { createHash, randomBytes } from 'node:crypto';
import pg from 'pg';

const args = process.argv.slice(2);
const email = args.find((a) => !a.startsWith('--'))?.trim().toLowerCase();
const grant = args.includes('--grant');
const slug = args.find((a) => a.startsWith('--course='))?.slice(9) ?? 'embroidery';
const origin = args.find((a) => a.startsWith('--origin='))?.slice(9)
  ?? (/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? '') ? 'http://localhost:4321' : 'https://www.re-create.art');

if (!email || !email.includes('@')) {
  console.error('Укажите почту: npm run course -- anna@example.com [--grant]');
  process.exit(1);
}

const url = process.env.DATABASE_URL;
let local = false;
try { local = ['localhost', '127.0.0.1'].includes(new URL(url).hostname); } catch {}
const client = new pg.Client(local ? { connectionString: url } : { connectionString: url, ssl: { rejectUnauthorized: true } });
await client.connect();

try {
  if (grant) {
    await client.query(
      `insert into course_access (course_id, email, source, expires_at)
       select id, $2, 'manual', now() + make_interval(months => access_months)
         from courses where slug = $1
       on conflict (course_id, email) do update
         set expires_at = greatest(course_access.expires_at, now())
                          + make_interval(months => (select access_months from courses where slug = $1)),
             revoked_at = null`,
      [slug, email],
    );
  }

  const token = randomBytes(24).toString('base64url');
  const hash = createHash('sha256').update(token).digest('hex');
  const { rows } = await client.query(
    `update course_access a
        set link_hash = $3, link_sent_at = now(), link_used_at = null
       from courses c
      where c.id = a.course_id and c.slug = $1 and a.email = $2
      returning a.expires_at::date::text as until, a.revoked_at is not null as revoked`,
    [slug, email, hash],
  );
  if (!rows[0]) {
    console.error(`У ${email} нет доступа к курсу ${slug}. Чтобы открыть: добавьте --grant`);
    process.exit(1);
  }
  console.log(`\n  ${email} · доступ до ${rows[0].until}${rows[0].revoked ? ' · ОТОЗВАН' : ''}`);
  console.log(`  ${origin}/learn/k/${token}\n`);
} finally {
  await client.end();
}
