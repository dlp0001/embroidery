// Письмо всем родителям сразу: берёт адреса из базы, подставляет имя и
// ссылку отказа, отправляет через Resend — тот же ключ, которым уходит код
// входа. Текст письма лежит отдельным файлом в scripts/letters/.
//
// Запуск:
//   node --env-file-if-exists=.env.local scripts/mail-blast.mjs camp-sukkot
//       — ничего не отправляет: показывает, кому уйдёт, и пишет письмо
//         в файл, чтобы посмотреть глазами.
//   ... scripts/mail-blast.mjs camp-sukkot --only me@example.com --send
//       — отправляет одному адресу. Так проверяется настоящее письмо.
//   ... scripts/mail-blast.mjs camp-sukkot --send --allow-remote
//       — отправляет всем. Обратно не отзовёшь.
//
// Повторный запуск не шлёт то же письмо дважды: отправленное записано
// в mail_log. Кто отказался от рассылки — не получает ничего.
import { createHmac } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';

const args = process.argv.slice(2);
const name = args.find((a) => !a.startsWith('--'));
const has = (flag) => args.includes(flag);
const value = (flag) => {
  const i = args.indexOf(flag);
  return i === -1 ? null : args[i + 1] ?? null;
};

const send = has('--send');
const allowRemote = has('--allow-remote');
const everyone = has('--all');
const only = value('--only');
const limit = Number(value('--limit') ?? 0) || null;

if (!name) {
  console.error('Какое письмо шлём? Например: scripts/mail-blast.mjs camp-sukkot');
  process.exit(1);
}

const letter = await import(`./letters/${name}.mjs`).catch(() => null);
if (!letter) {
  console.error(`Письма scripts/letters/${name}.mjs нет.`);
  process.exit(1);
}

const url = process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL не задан'); process.exit(1); }

const host = new URL(url).hostname;
const local = host === 'localhost' || host === '127.0.0.1';
if (!local && send && !only && !allowRemote) {
  console.error(`База не локальная (${host}). Рассылке по ней нужен флаг --allow-remote.`);
  process.exit(1);
}

const SITE = process.env.SITE_URL ?? 'https://www.re-create.art';
const FROM = process.env.MAIL_FROM ?? 'Варя · Re.Create.Art <info@re-create.art>';
const REPLY_TO = process.env.MAIL_REPLY_TO ?? 'info@re-create.art';

/**
 * Ссылка отказа подписана, чтобы по чужому адресу нельзя было отписать
 * человека. Та же подпись проверяется в src/lib/mail.ts — если меняете
 * здесь, поменяйте и там.
 */
function unsubToken(email) {
  const secret = process.env.SESSION_SECRET ?? '';
  return createHmac('sha256', secret).update(`unsub:${email.toLowerCase()}`).digest('hex').slice(0, 32);
}

function unsubUrl(email, path = '/unsubscribe') {
  const q = new URLSearchParams({ e: email.toLowerCase(), t: unsubToken(email) });
  return `${SITE}${path}?${q}`;
}

const c = new pg.Client(local ? { connectionString: url } : { connectionString: url, ssl: { rejectUnauthorized: true } });
await c.connect();

const campaign = letter.campaign ?? name;

// Названный адрес отбирать не по кому: человек его написал сам, значит
// письмо нужно именно туда. Ни «родитель ли он», ни «не получал ли уже»
// тут не спрашиваем — иначе своим же адресом проверить письмо нельзя,
// а именно на нём его и проверяют. Отказ от рассылки уважаем всегда.
const where = ['u.email is not null', 'u.mail_optout_at is null'];
const params = [];

if (only) {
  params.push(only.toLowerCase());
  where.push(`u.email = $${params.length}`);
} else {
  params.push(campaign);
  where.push(`not exists (select 1 from mail_log m
                           where m.campaign = $${params.length} and m.email = u.email)`);
  // Родители — те, у кого есть неархивный ребёнок. С --all письмо уходит
  // каждому, у кого в базе есть почта: и взрослым ученикам тоже.
  if (!everyone) {
    where.push(`exists (select 1 from guardians g join children ch on ch.id = g.child_id
                         where g.user_id = u.id and ch.archived_at is null)`);
  }
}

const { rows } = await c.query(
  `select u.id, u.email::text as email, u.name
     from users u
    where ${where.join('\n      and ')}
    order by u.email`,
  params,
);

let to = limit ? rows.slice(0, limit) : rows;

// Названного адреса может вообще не быть в базе: так и проверяют письмо,
// на своей почте, а учётки в студии у себя не заводят. Отправляем как есть,
// без имени, но говорим об этом вслух — вдруг это просто опечатка.
let unknown = false;
let refusal = null;
if (only && to.length === 0) {
  const who = await c.query(
    'select mail_optout_at from users where email = $1', [only.toLowerCase()]);
  if (who.rows.length === 0) {
    unknown = true;
    to = [{ id: null, email: only.toLowerCase(), name: null }];
  } else if (who.rows[0].mail_optout_at) {
    refusal = `${only} отказался от рассылки.`;
  }
}

const skipped = await c.query(
  `select count(*)::int as n from mail_log where campaign = $1`, [campaign]);
const optedOut = await c.query(
  `select count(*)::int as n from users where mail_optout_at is not null`);

console.log(`Письмо: ${campaign}`);
console.log(`Тема:   ${letter.subject}`);
console.log(`База:   ${host}`);
console.log(`Кому:   ${only ? `${to.length} (адрес назван руками)`
                            : `${to.length} ${everyone ? 'человек (все с почтой)' : 'родителей'}`}` +
            `${skipped.rows[0].n ? `, уже получили: ${skipped.rows[0].n}` : ''}` +
            `${optedOut.rows[0].n ? `, отказались: ${optedOut.rows[0].n}` : ''}`);
if (unknown) console.log(`Внимание: ${only} в базе нет. Шлём на него как есть, имя не подставится.`);

if (to.length === 0) {
  // Пустой список почти всегда означает опечатку в адресе или отказ от
  // рассылки. Гадать об этом по молчанию скрипта не надо.
  console.log(refusal ?? 'Отправлять некому: все либо уже получили письмо, либо отказались.');
  await c.end();
  process.exit(0);
}

if (!send) {
  const sample = to[0];
  const file = join(tmpdir(), `${campaign}.html`);
  await writeFile(file, letter.html({ name: sample.name, unsubscribeUrl: unsubUrl(sample.email) }));
  // Не просто список адресов, а то, чем начнётся письмо у каждого: имена
  // в базе бывают пустые, задом наперёд и не тем алфавитом, и увидеть это
  // надо до отправки, а не в чужом почтовом ящике.
  const SHOW = 30;
  const wide = Math.max(...to.slice(0, SHOW).map((r) => r.email.length));
  console.log('\nКому уйдёт:');
  for (const r of to.slice(0, SHOW)) {
    const greeting = letter.hello ? letter.hello(r.name) : (r.name ?? '');
    console.log(`   ${r.email.padEnd(wide)}   ${greeting}`);
  }
  if (to.length > SHOW) console.log(`   … и ещё ${to.length - SHOW}`);
  console.log(`\nПисьмо целиком: ${file}`);
  console.log('Ничего не отправлено. Отправить — флаг --send.');
  await c.end();
  process.exit(0);
}

const key = process.env.RESEND_API_KEY;
if (!key) { console.error('RESEND_API_KEY не задан, отправлять нечем.'); await c.end(); process.exit(1); }

let ok = 0;
let failed = 0;
for (const r of to) {
  const vars = { name: r.name, unsubscribeUrl: unsubUrl(r.email) };
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: FROM,
        to: r.email,
        reply_to: REPLY_TO,
        subject: letter.subject,
        html: letter.html(vars),
        text: letter.text(vars),
        headers: {
          // Кнопка «отписаться» в самом почтовике: письмо без неё чаще
          // уезжает в спам, а человек вместо отказа жмёт «это спам».
          'List-Unsubscribe': `<${unsubUrl(r.email, '/api/unsubscribe')}>`,
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        },
      }),
    });
    if (!res.ok) {
      console.error(`   ✗ ${r.email}: ${res.status} ${await res.text()}`);
      failed++;
    } else {
      const { id } = await res.json();
      await c.query(
        `insert into mail_log (campaign, email, user_id, provider_id)
         values ($1, $2, $3, $4) on conflict do nothing`,
        [campaign, r.email, r.id, id ?? null],
      );
      console.log(`   ✓ ${r.email}`);
      ok++;
    }
  } catch (err) {
    console.error(`   ✗ ${r.email}: ${err.message}`);
    failed++;
  }
  // Resend пускает два письма в секунду. Спешить некуда.
  await new Promise((r) => setTimeout(r, 600));
}

console.log(`\nОтправлено ${ok}${failed ? `, не ушло ${failed}` : ''}.`);
await c.end();
