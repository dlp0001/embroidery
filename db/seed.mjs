// Тестовые данные для разработки. Идемпотентно: чистит студийные таблицы и заливает заново.
import pg from 'pg';

const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();

await c.query(`truncate charges, attendance, bookings, studio_sessions, studio_members,
               studio_groups, passes, participants, guardians, children, user_roles,
               sessions, login_codes, users restart identity cascade`);

await c.query(`insert into settings (key, value) values
  ('studio_lesson_price', '60'), ('studio_currency', 'ILS')
  on conflict (key) do update set value = excluded.value`);

const user = async (email, name, roles) => {
  const { rows } = await c.query('insert into users (email, name) values ($1, $2) returning id', [email, name]);
  const id = rows[0].id;
  for (const r of roles) await c.query('insert into user_roles (user_id, role) values ($1, $2)', [id, r]);
  await c.query('insert into participants (user_id) values ($1)', [id]);
  return id;
};

const varya = await user('varya@re-create.art', 'Варя Перлина', ['teacher', 'admin']);
const dima  = await user('dmitriy.perlin@gmail.com', 'Дима', ['superadmin', 'admin']);
const anna  = await user('anna@example.com', 'Анна', ['parent', 'student']);
const olga  = await user('olga@example.com', 'Ольга', ['parent']);

const child = async (name, parents) => {
  const { rows } = await c.query('insert into children (name) values ($1) returning id', [name]);
  const id = rows[0].id;
  for (const p of parents) await c.query('insert into guardians (child_id, user_id) values ($1, $2)', [id, p]);
  const { rows: pr } = await c.query('insert into participants (child_id) values ($1) returning id', [id]);
  return pr[0].id;
};

const mia   = await child('Мия', [anna]);
const lyova = await child('Лёва', [anna]);
const tamar = await child('Тамар', [olga]);
const noam  = await child('Ноам', [olga]);

const group = async (title, weekday, startsAt, audience, ageHint, capacity) => {
  const { rows } = await c.query(
    `insert into studio_groups (title, teacher_id, weekday, starts_at, audience, age_hint, capacity)
     values ($1, $2, $3, $4, $5, $6, $7) returning id`,
    [title, varya, weekday, startsAt, audience, ageHint, capacity]);
  return rows[0].id;
};

const junior = await group('Младшие', 3, '16:30', 'kids', '6–8 лет', 10);
const middle = await group('Средние', 3, '18:00', 'kids', '9–11 лет', 12);
const senior = await group('Старшие', 7, '17:00', 'teens', '12+ лет', 10);
const adults = await group('Взрослые', 6, '11:00', 'adults', null, 8);

const annaSelf = (await c.query('select id from participants where user_id = $1', [anna])).rows[0].id;

const member = (g, p) => c.query('insert into studio_members (group_id, participant_id) values ($1, $2)', [g, p]);
await member(junior, mia);
await member(middle, lyova);
await member(junior, noam);
await member(middle, tamar);
await member(adults, annaSelf);

// Занятия на месяц назад и шесть недель вперёд
await c.query(
  `insert into studio_sessions (group_id, held_on)
   select g.id, d::date
     from studio_groups g
     cross join generate_series(current_date - interval '35 days', current_date + interval '42 days', interval '1 day') d
    where g.active and extract(isodow from d) = g.weekday
   on conflict do nothing`);

// Абонемент Анны на 8 занятий, куплен три недели назад
const { rows: pass } = await c.query(
  `insert into passes (owner_id, lessons_total, valid_from, valid_to)
   values ($1, 8, current_date - interval '21 days', current_date + interval '60 days') returning id`,
  [anna]);
const passId = pass[0].id;

// Прошедшие занятия: до абонемента — долг, после — списание с пакета
const past = (await c.query(
  `select s.id, s.held_on, s.group_id from studio_sessions s
    where s.held_on < current_date order by s.held_on`)).rows;

const membersOf = { [junior]: [mia, noam], [middle]: [lyova, tamar], [adults]: [annaSelf] };
const ownerOf = { [mia]: anna, [lyova]: anna, [annaSelf]: anna, [tamar]: olga, [noam]: olga };

let usedFromPass = 0;
for (const s of past) {
  const ps = membersOf[s.group_id] ?? [];
  if (ps.length === 0) continue;
  await c.query(`update studio_sessions set status = 'done', closed_at = now() where id = $1`, [s.id]);
  for (const p of ps) {
    await c.query(
      `insert into attendance (session_id, participant_id, status, marked_by)
       values ($1, $2, 'present', $3) on conflict do nothing`, [s.id, p, varya]);
    const owner = ownerOf[p];
    const buysWithPass = owner === anna && new Date(s.held_on) >= new Date(Date.now() - 21 * 864e5) && usedFromPass < 3;
    if (buysWithPass) usedFromPass++;
    await c.query(
      `insert into charges (participant_id, session_id, owner_id, amount, currency, pass_id)
       values ($1, $2, $3, 60, 'ILS', $4) on conflict do nothing`,
      [p, s.id, owner, buysWithPass ? passId : null]);
  }
}

const stat = async (q) => (await c.query(q)).rows[0];
console.log('пользователи ', (await stat('select count(*) n from users')).n);
console.log('группы       ', (await stat('select count(*) n from studio_groups')).n);
console.log('занятия      ', (await stat('select count(*) n from studio_sessions')).n);
console.log('начисления   ', (await stat('select count(*) n from charges')).n);
console.log('из них долг  ', (await stat('select count(*) n from charges where pass_id is null and payment_id is null')).n);
console.log('на абонементе', (await stat('select count(*) n from charges where pass_id is not null')).n);
await c.end();
