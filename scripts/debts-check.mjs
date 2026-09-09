// Что именно показывает экран «Финансы»: долги по семьям и из чего они
// сложились. Только чтение.
import pg from 'pg';

const url = process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL не задан'); process.exit(1); }
let local = false;
try {
  const h = new URL(url).hostname;
  local = h === 'localhost' || h === '127.0.0.1';
} catch {}

const c = new pg.Client(local ? { connectionString: url } : { connectionString: url, ssl: { rejectUnauthorized: true } });
await c.connect();
try {
  const { rows } = await c.query(
    `select coalesce(u.name, u.email) as who, count(*)::int as n,
            sum(ch.amount)::text as sum, min(s.held_on)::text as first_day,
            string_agg(distinct coalesce(cd.name, u.name, '?'), ', ') as people
       from charges ch
       join users u on u.id = ch.owner_id
       join studio_sessions s on s.id = ch.session_id
       join participants p on p.id = ch.participant_id
       left join children cd on cd.id = p.child_id
      where ch.pass_id is null and ch.payment_id is null
      group by u.id, u.name, u.email
      order by sum(ch.amount) desc`);

  console.log('Долги по семьям:');
  for (const r of rows) {
    console.log(`  ${r.who}: ${r.n} занятий на ${r.sum} ₪, с ${r.first_day}`);
    console.log(`    ${r.people}`);
  }
  const total = rows.reduce((s, r) => s + Number(r.sum), 0);
  console.log(`  ─ всего ${total} ₪ у ${rows.length} семей`);

  const { rows: [all] } = await c.query(
    `select count(*)::int as n,
            count(*) filter (where pass_id is not null)::int as on_pass,
            count(*) filter (where payment_id is not null)::int as paid,
            count(*) filter (where owner_id is null)::int as ownerless,
            coalesce(sum(amount), 0)::text as sum
       from charges`);
  console.log(`\nВсего начислений: ${all.n} на ${all.sum} ₪`);
  console.log(`  по абонементу ${all.on_pass}, оплачено ${all.paid}, без плательщика ${all.ownerless}`);

  const { rows: amounts } = await c.query(
    `select ch.amount::text as amount, count(*)::int as n
       from charges ch where ch.pass_id is null and ch.payment_id is null
      group by ch.amount order by ch.amount`);
  console.log('\nЦены в неоплаченных начислениях:');
  for (const a of amounts) console.log(`  ${a.amount} ₪ × ${a.n}`);

  const { rows: passes } = await c.query(
    `select coalesce(u.name, u.email) as who, ps.lessons_total,
            ps.lessons_total - (select count(*)::int from charges c2 where c2.pass_id = ps.id) as left,
            ps.valid_to::text, (ps.payment_id is null) as unpaid
       from passes ps join users u on u.id = ps.owner_id
      where ps.valid_to is null or ps.valid_to >= current_date
      order by u.name`);
  console.log('\nДействующие абонементы:');
  for (const p of passes) {
    console.log(`  ${p.who}: осталось ${p.left} из ${p.lessons_total}, до ${p.valid_to}${p.unpaid ? ', не оплачен' : ''}`);
  }
  if (passes.length === 0) console.log('  ни одного');

  const { rows: claims } = await c.query(
    `select coalesce(u.name, u.email) as who, p.amount::text, p.created_at::text
       from payments p join users u on u.id = p.user_id
      where p.provider = 'cash' and p.status = 'pending'`);
  const { rows: lost } = await c.query(
    `select coalesce(cd.name, u.name, '?') as who, s.held_on::text as day,
            exists (select 1 from guardians g where g.child_id = p.child_id) as has_parent
       from attendance a
       join participants p on p.id = a.participant_id
       join studio_sessions s on s.id = a.session_id
       left join children cd on cd.id = p.child_id
       left join users u on u.id = p.user_id
      where a.status = 'present'
        and not exists (select 1 from charges x
                         where x.participant_id = a.participant_id
                           and x.session_id = a.session_id)
      order by s.held_on`);
  console.log('\nПосещения без начисления (деньги нигде не учтены):');
  for (const l of lost) {
    console.log(`  ${l.day} · ${l.who}${l.has_parent ? ' · родитель есть' : ' · родителя нет'}`);
  }
  if (lost.length === 0) console.log('  таких нет');

  console.log('\nЖдут подтверждения:');
  for (const cl of claims) console.log(`  ${cl.who}: ${cl.amount} ₪ от ${cl.created_at.slice(0,10)}`);
  if (claims.length === 0) console.log('  ни одной заявки');
} finally {
  await c.end();
}
