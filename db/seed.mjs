// Тестовые данные для разработки. Идемпотентно: чистит студийные таблицы и заливает заново.
import pg from 'pg';

/** Neon требует SSL, локальный докер его не умеет. */
function pgConfig(connectionString) {
  let local = false;
  try {
    const host = new URL(connectionString).hostname;
    local = host === 'localhost' || host === '127.0.0.1';
  } catch {}
  return local ? { connectionString } : { connectionString, ssl: { rejectUnauthorized: true } };
}

const c = new pg.Client(pgConfig(process.env.DATABASE_URL));
await c.connect();

await c.query(`truncate charges, attendance, bookings, studio_sessions, studio_members,
               studio_groups, passes, participants, guardians, children, user_roles,
               preferred_days, payments, sessions, login_codes, users restart identity cascade`);

await c.query(`insert into settings (key, value) values
  ('studio_lesson_price', '60'), ('studio_currency', 'ILS')
  on conflict (key) do update set value = excluded.value`);

const user = async (email, name, roles) => {
  const { rows } = await c.query('insert into users (email, name) values ($1, $2) returning id', [email, name]);
  const id = rows[0].id;
  for (const r of roles) await c.query('insert into user_roles (user_id, role) values ($1, $2)', [id, r]);
  const { rows: p } = await c.query('insert into participants (user_id) values ($1) returning id', [id]);
  return { id, participant: p[0].id };
};

const varya = await user('varya@re-create.art', 'Варя Перлина', ['teacher', 'admin']);
await user('dmitriy.perlin@gmail.com', 'Дима', ['superadmin', 'admin']);
const anna   = await user('anna@example.com', 'Анна', ['parent', 'student']);
const olga   = await user('olga@example.com', 'Ольга', ['parent']);
const irina  = await user('irina@example.com', 'Ирина', ['parent']);
const dina   = await user('dina@example.com', 'Дина', ['parent']);
const marina = await user('marina@example.com', 'Марина', ['parent']);

/** Ребёнок с опекуном и приоритетными днями недели. */
const child = async (name, parent, days) => {
  const { rows } = await c.query('insert into children (name) values ($1) returning id', [name]);
  const id = rows[0].id;
  await c.query('insert into guardians (child_id, user_id) values ($1, $2)', [id, parent.id]);
  const { rows: p } = await c.query('insert into participants (child_id) values ($1) returning id', [id]);
  for (const d of days) {
    await c.query('insert into preferred_days (participant_id, weekday) values ($1, $2)', [p[0].id, d]);
  }
  return p[0].id;
};

// Младшие ходят по средам (3). Четверо отметили среду в профиле,
// пятеро обычно ходят в другие дни.
const mia      = await child('Мия', anna, [3]);
const ari      = await child('Ари', irina, [3]);
const sofi     = await child('Софи', dina, [3]);
const itay     = await child('Итай', marina, [3]);
const noam     = await child('Ноам', olga, [1]);
const leya     = await child('Лея', irina, [2]);
const yonatan  = await child('Йонатан', marina, [4]);
const daniel   = await child('Даниэль', marina, [5]);
const noa      = await child('Ноа', dina, [7]);

const lyova = await child('Лёва', anna, [3]);
const tamar = await child('Тамар', olga, [3]);

const group = async (title, weekday, startsAt, audience, ageHint, capacity) => {
  const { rows } = await c.query(
    `insert into studio_groups (title, teacher_id, weekday, starts_at, audience, age_hint, capacity)
     values ($1, $2, $3, $4, $5, $6, $7) returning id`,
    [title, varya.id, weekday, startsAt, audience, ageHint, capacity]);
  return rows[0].id;
};

const junior = await group('Младшие', 3, '16:30', 'kids', '6–8 лет', 12);
const middle = await group('Средние', 3, '18:00', 'kids', '9–11 лет', 12);
const senior = await group('Старшие', 7, '17:00', 'kids', '12+ лет', 10);
const adults = await group('Взрослые', 6, '11:00', 'adults', null, 8);

const member = (g, p) => c.query('insert into studio_members (group_id, participant_id) values ($1, $2)', [g, p]);
for (const p of [mia, ari, sofi, itay, noam, leya, yonatan, daniel, noa]) await member(junior, p);
for (const p of [lyova, tamar]) await member(middle, p);
await member(senior, noa);
await member(adults, anna.participant);

// Занятия на месяц назад и шесть недель вперёд
await c.query(
  `insert into studio_sessions (group_id, held_on)
   select g.id, d::date
     from studio_groups g
     cross join generate_series(current_date - interval '35 days', current_date + interval '42 days', interval '1 day') d
    where g.active and extract(isodow from d) = g.weekday
   on conflict do nothing`);

// Абонементы: у Анны и у Ирины
const pass = async (owner, total) => {
  const { rows } = await c.query(
    `insert into passes (owner_id, lessons_total, valid_from, valid_to)
     values ($1, $2, current_date - interval '21 days', current_date + interval '60 days') returning id`,
    [owner.id, total]);
  return rows[0].id;
};
const annaPass = await pass(anna, 8);
await pass(irina, 8);

// Ари записан родителем на ближайшую среду — единственный, у кого будет
// «по абонементу» ещё до отметки.
await c.query(
  `insert into bookings (session_id, participant_id, status)
   select s.id, $1, 'booked' from studio_sessions s
    where s.group_id = $2 and s.held_on >= current_date
    order by s.held_on limit 1`,
  [ari, junior]);

// Прошедшие занятия: часть на абонемент Анны, остальное в долг
const past = (await c.query(
  `select s.id, s.held_on, s.group_id from studio_sessions s
    where s.held_on < current_date order by s.held_on`)).rows;

const membersOf = {
  [junior]: [mia, ari, sofi, itay, noam],
  [middle]: [lyova, tamar],
  [adults]: [anna.participant],
};
const ownerOf = {
  [mia]: anna.id, [lyova]: anna.id, [anna.participant]: anna.id,
  [tamar]: olga.id, [noam]: olga.id,
  [ari]: irina.id, [leya]: irina.id,
  [sofi]: dina.id, [noa]: dina.id,
  [itay]: marina.id, [yonatan]: marina.id, [daniel]: marina.id,
};

let fromPass = 0;
for (const s of past) {
  const ps = membersOf[s.group_id] ?? [];
  if (ps.length === 0) continue;
  await c.query(`update studio_sessions set status = 'done', closed_at = now() where id = $1`, [s.id]);
  for (const p of ps) {
    await c.query(
      `insert into attendance (session_id, participant_id, status, marked_by)
       values ($1, $2, 'present', $3) on conflict do nothing`, [s.id, p, varya.id]);
    const onPass = ownerOf[p] === anna.id && fromPass < 3;
    if (onPass) fromPass++;
    await c.query(
      `insert into charges (participant_id, session_id, owner_id, amount, currency, pass_id)
       values ($1, $2, $3, 60, 'ILS', $4) on conflict do nothing`,
      [p, s.id, ownerOf[p], onPass ? annaPass : null]);
  }
}

const stat = async (q) => (await c.query(q)).rows[0].n;
console.log('пользователи   ', await stat('select count(*) n from users'));
console.log('дети           ', await stat('select count(*) n from children'));
console.log('в группе Младшие', await stat(`select count(*) n from studio_members m join studio_groups g on g.id=m.group_id where g.title='Младшие'`));
console.log('ждём по средам ', await stat(`select count(*) n from preferred_days where weekday=3`));
console.log('занятия        ', await stat('select count(*) n from studio_sessions'));
console.log('начисления     ', await stat('select count(*) n from charges'));
console.log('из них долг    ', await stat('select count(*) n from charges where pass_id is null and payment_id is null'));
await c.end();
