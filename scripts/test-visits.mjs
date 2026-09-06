// Тестовые посещения задним числом. Отмечает всех участников групп на
// прошедших занятиях и считает деньги так же, как это делает журнал.
// Запуск:  npm run visits -- --weeks 4
// Убрать:  npm run visits -- --remove
import pg from 'pg';

function pgConfig(connectionString) {
  let local = false;
  try {
    const host = new URL(connectionString).hostname;
    local = host === 'localhost' || host === '127.0.0.1';
  } catch {}
  return local ? { connectionString } : { connectionString, ssl: { rejectUnauthorized: true } };
}

const args = process.argv.slice(2);
const remove = args.includes('--remove');
const weeks = args.includes('--weeks') ? Number(args[args.indexOf('--weeks') + 1]) : 4;

const c = new pg.Client(pgConfig(process.env.DATABASE_URL));
await c.connect();

if (remove) {
  const { rowCount: ev } = await c.query(`delete from money_events where note like '%тестовое%'`);
  const { rowCount: ch } = await c.query(
    `delete from charges c using studio_sessions s
      where c.session_id = s.id and s.held_on < current_date`);
  const { rowCount: at } = await c.query(
    `delete from attendance a using studio_sessions s
      where a.session_id = s.id and s.held_on < current_date`);
  await c.query(
    `update studio_sessions set status = 'planned', closed_at = null where held_on < current_date`);
  console.log(`убрано: посещений ${at}, начислений ${ch}, событий ${ev}`);
  await c.end();
  process.exit(0);
}

const price = Number((await c.query(
  `select value from settings where key = 'studio_lesson_price'`)).rows[0]?.value ?? 60);
const currency = (await c.query(
  `select value from settings where key = 'studio_currency'`)).rows[0]?.value ?? 'ILS';
const actor = (await c.query(
  `select u.id from users u join user_roles r on r.user_id = u.id and r.role = 'teacher' limit 1`)).rows[0]?.id ?? null;

const sessions = (await c.query(
  `select s.id, s.held_on, g.title
     from studio_sessions s join studio_groups g on g.id = s.group_id
    where s.held_on < current_date
      and s.held_on >= current_date - ($1 || ' weeks')::interval
      and s.status <> 'cancelled'
      and exists (select 1 from studio_members m where m.group_id = g.id and m.left_at is null)
    order by s.held_on`, [String(weeks)])).rows;

let marked = 0, onPass = 0, debt = 0, cash = 0, skipped = 0;

for (const s of sessions) {
  const people = (await c.query(
    `select m.participant_id, coalesce(ch.name, u.name) as who,
            coalesce(p.user_id, (select g2.user_id from guardians g2 where g2.child_id = p.child_id order by g2.user_id limit 1)) as owner_id
       from studio_members m
       join participants p on p.id = m.participant_id
       left join children ch on ch.id = p.child_id
       left join users u on u.id = p.user_id
       join studio_sessions ss on ss.id = $1
      where m.group_id = ss.group_id and m.left_at is null`, [s.id])).rows;

  await c.query('begin');
  for (const [i, person] of people.entries()) {
    // Каждый десятый пропускает, каждый седьмой болеет — чтобы данные
    // не выглядели идеально ровными.
    const n = (marked + i) % 10;
    const status = n === 3 ? 'absent' : n === 7 ? 'sick' : 'present';
    await c.query(
      `insert into attendance (session_id, participant_id, status, marked_by)
       values ($1, $2, $3, $4) on conflict do nothing`, [s.id, person.participant_id, status, actor]);
    marked++;
    if (status !== 'present' || !person.owner_id) { skipped++; continue; }

    const already = await c.query(
      'select 1 from charges where session_id = $1 and participant_id = $2', [s.id, person.participant_id]);
    if (already.rowCount) continue;

    const pass = (await c.query(
      `select p.id from passes p
        where p.owner_id = $1 and p.valid_from <= $2::date
          and (p.valid_to is null or p.valid_to >= $2::date)
          and (select count(*) from charges c2 where c2.pass_id = p.id) < p.lessons_total
        order by p.valid_to nulls last, p.created_at limit 1`, [person.owner_id, s.held_on])).rows[0];

    // Часть долгов сразу гасим наличными, чтобы в реестре были разные события.
    const payCash = !pass && marked % 4 === 0;
    let paymentId = null;
    if (payCash) {
      paymentId = (await c.query(
        `insert into payments (provider, user_id, amount, currency, status, purpose)
         values ('cash', $1, $2, $3, 'paid', 'studio_lesson') returning id`,
        [person.owner_id, price, currency])).rows[0].id;
    }

    const charge = (await c.query(
      `insert into charges (participant_id, session_id, owner_id, amount, currency, pass_id, payment_id, created_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8::date + time '20:00') returning id`,
      [person.participant_id, s.id, person.owner_id, price, currency,
       pass?.id ?? null, paymentId, s.held_on])).rows[0].id;

    await c.query(
      `insert into money_events (kind, at, actor_id, owner_id, participant_id, session_id,
                                 charge_id, pass_id, payment_id, amount, currency, note)
       values ($1, $2::date + time '20:00', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [pass ? 'charge_on_pass' : paymentId ? 'cash_taken' : 'charge_created',
       s.held_on, actor, person.owner_id, person.participant_id, s.id, charge,
       pass?.id ?? null, paymentId, price, currency,
       (pass ? 'списано с абонемента' : paymentId ? 'приняты наличные, 1 занятие' : 'занятие в долг') + ' · тестовое']);

    if (pass) onPass++; else if (paymentId) cash++; else debt++;
  }
  await c.query(`update studio_sessions set status = 'done', closed_at = now() where id = $1`, [s.id]);
  await c.query('commit');
}

console.log(`занятий обработано: ${sessions.length}`);
console.log(`отметок: ${marked} (пропусков и болезней: ${skipped})`);
console.log(`списано с абонемента: ${onPass}`);
console.log(`оплачено налом: ${cash}`);
console.log(`в долг: ${debt}`);
console.log('\nубрать: npm run visits -- --remove');
await c.end();
