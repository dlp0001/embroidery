// Заводит лагерь или мастер-класс: группу с периодом, своей ценой и
// пакетами, и дни внутри периода. То же самое, что форма «Группы» в
// кабинете, — нужно, когда завести надо снаружи.
//
// Запуск:
//   node --env-file-if-exists=.env.local scripts/camp-add.mjs
//   npm run camp:prod -- --allow-remote        (боевая база)
//
// Без --apply ничего не пишет, только показывает, что получится.
import pg from 'pg';

const CAMP = {
  title: 'Лагерь на Суккот',
  kind: 'camp',
  audience: 'kids',
  startsOn: '2026-09-22',
  endsOn: '2026-10-02',
  // Дни недели по ISO: 1 — понедельник, 7 — воскресенье. Суббота (6) выпадает.
  weekdays: [1, 2, 3, 4, 5, 7],
  startsAt: '09:00',
  durationMin: 300,
  price: 330,
  passOffers: [
    { lessons: 5, price: 1550 },
    { lessons: 6, price: 1800 },
    { lessons: 7, price: 2000 },
  ],
  ageHint: null,
  capacity: null,
  room: null,
  // Кого ставим преподавателем: ищем по почте среди учителей.
  teacherEmail: null,
};

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const allowRemote = args.includes('--allow-remote');

const url = process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL не задан'); process.exit(1); }

const host = new URL(url).hostname;
const local = host === 'localhost' || host === '127.0.0.1';
if (!local && !allowRemote) {
  console.error(`База не локальная (${host}). Для неё нужен флаг --allow-remote.`);
  process.exit(1);
}

const c = new pg.Client(local ? { connectionString: url } : { connectionString: url, ssl: { rejectUnauthorized: true } });
await c.connect();
// «Сегодня» должно совпадать с тем, что видит студия.
await c.query("set time zone 'Asia/Jerusalem'");

const teacher = CAMP.teacherEmail
  ? (await c.query('select id, name from users where lower(email) = lower($1)', [CAMP.teacherEmail])).rows[0]
  : (await c.query(
      `select u.id, u.name from users u
        where exists (select 1 from user_roles r
                       where r.user_id = u.id and r.role = 'teacher')
        order by u.created_at limit 1`,
    )).rows[0];

const exists = (await c.query(
  'select id, title from studio_groups where kind <> $1 and starts_on = $2::date',
  ['lesson', CAMP.startsOn],
)).rows[0];

console.log(`база: ${host}`);
console.log(`преподаватель: ${teacher ? `${teacher.name ?? teacher.id}` : 'не назначен'}`);
if (exists) {
  console.log(`уже есть смена с этой датой: ${exists.title} (${exists.id}) — ничего не делаю`);
  await c.end();
  process.exit(0);
}

if (!apply) {
  console.log('\nбудет заведено:');
  console.log(` ${CAMP.title}: ${CAMP.startsOn} — ${CAMP.endsOn}, дни ${CAMP.weekdays.join(',')}`);
  console.log(` с ${CAMP.startsAt} на ${CAMP.durationMin} мин, ${CAMP.price} за день`);
  console.log(` пакеты: ${CAMP.passOffers.map((o) => `${o.lessons} за ${o.price}`).join(', ')}`);
  console.log('\nповторите с --apply, чтобы записать');
  await c.end();
  process.exit(0);
}

const group = (await c.query(
  `insert into studio_groups
     (title, weekday, starts_at, duration_min, audience, age_hint, capacity, room,
      teacher_id, kind, price, pass_offers, starts_on, ends_on, weekdays)
   values ($1, null, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::date, $13::date, $14)
   returning id`,
  [CAMP.title, CAMP.startsAt, CAMP.durationMin, CAMP.audience, CAMP.ageHint,
   CAMP.capacity, CAMP.room, teacher?.id ?? null, CAMP.kind, CAMP.price,
   JSON.stringify(CAMP.passOffers), CAMP.startsOn, CAMP.endsOn, CAMP.weekdays],
)).rows[0];

// Дни смены — как их создаёт resyncGroupSessions в приложении.
await c.query(
  `insert into studio_sessions (group_id, held_on)
   select g.id, d::date
     from studio_groups g
     cross join generate_series(greatest(g.starts_on, current_date), g.ends_on::timestamp, interval '1 day') d
    where g.id = $1
      and (cardinality(g.weekdays) = 0 or extract(isodow from d)::int = any(g.weekdays))
   on conflict (group_id, held_on) do nothing`,
  [group.id],
);

const days = (await c.query(
  `select held_on::text, to_char(held_on, 'Dy') as dow from studio_sessions
    where group_id = $1 order by held_on`,
  [group.id],
)).rows;

console.log(`\nзаведено: ${CAMP.title} (${group.id})`);
console.log(`дней: ${days.length}`);
for (const d of days) console.log('  ', d.held_on, d.dow);
await c.end();
