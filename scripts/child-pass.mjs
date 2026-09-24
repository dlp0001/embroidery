// Чем закрыты занятия ребёнка и что это за абонемент. Только читает.
// node --env-file-if-exists=.env.production.local scripts/child-pass.mjs Лерман
import pg from 'pg';

const needle = process.argv.slice(2).find((a) => !a.startsWith('-'));
if (!needle) { console.error('нужно имя или его часть'); process.exit(1); }

const url = process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL не задан'); process.exit(1); }
const host = new URL(url).hostname;
const local = host === 'localhost' || host === '127.0.0.1';

const c = new pg.Client(local ? { connectionString: url } : { connectionString: url, ssl: { rejectUnauthorized: true } });
await c.connect();
await c.query("set time zone 'Asia/Jerusalem'");

const { rows: charges } = await c.query(
  `select k.name as who, s.held_on::text, g.title, ch.amount::text,
          ch.pass_id, ch.payment_id,
          coalesce(u.name, u.email) as owner
     from charges ch
     join participants p on p.id = ch.participant_id
     join children k on k.id = p.child_id
     join studio_sessions s on s.id = ch.session_id
     join studio_groups g on g.id = s.group_id
     left join users u on u.id = ch.owner_id
    where k.name ilike '%' || $1 || '%'
    order by s.held_on desc, k.name
    limit 30`,
  [needle],
);

console.log(`база: ${host}\n`);
if (charges.length === 0) console.log('начислений не нашлось');
for (const r of charges) {
  const how = r.pass_id ? 'по абонементу' : r.payment_id ? 'оплачено' : 'не оплачено';
  console.log(`${r.held_on}  ${r.who.padEnd(16)} ${r.title.padEnd(16)} ${r.amount.padStart(7)}  ${how}`);
}

const ids = [...new Set(charges.map((r) => r.pass_id).filter(Boolean))];
if (ids.length > 0) {
  const { rows: passes } = await c.query(
    `select ps.id, ps.lessons_total, ps.valid_from::text, ps.valid_to::text,
            coalesce(u.name, u.email) as owner,
            (select count(*)::int from charges ch where ch.pass_id = ps.id) as used,
            ps.valid_to < current_date as expired,
            (select g.title from studio_groups g where g.id = ps.group_id) as group_title,
            pay.provider, pay.amount::text as paid, pay.status
       from passes ps
       join users u on u.id = ps.owner_id
       left join payments pay on pay.id = ps.payment_id
      where ps.id = any($1::uuid[])`,
    [ids],
  );
  console.log('\nабонементы, с которых списано:');
  for (const p of passes) {
    console.log(`  ${p.owner}: ${p.used} из ${p.lessons_total}, ${p.valid_from} — ${p.valid_to}` +
      `${p.expired ? ' (срок вышел)' : ''}${p.group_title ? ` · ${p.group_title}` : ''}`);
    console.log(`    оплата: ${p.provider ?? 'не оплачен'}${p.paid ? ` ${p.paid}` : ''}${p.status ? ` · ${p.status}` : ''}`);
    console.log(`    виден Варе в списке: ${!p.expired && p.used < p.lessons_total ? 'да' : 'нет'}`);
  }
}
await c.end();
