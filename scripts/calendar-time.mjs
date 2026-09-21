// Сколько времени занимают запросы календаря. Только читает.
// Запуск: node --env-file-if-exists=.env.production.local scripts/calendar-time.mjs
import pg from 'pg';

const url = process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL не задан'); process.exit(1); }
const host = new URL(url).hostname;
const local = host === 'localhost' || host === '127.0.0.1';

const c = new pg.Client(local ? { connectionString: url } : { connectionString: url, ssl: { rejectUnauthorized: true } });
await c.connect();
await c.query("set time zone 'Asia/Jerusalem'");

const first = '2026-09-01';
const last = '2026-09-30';

/** Время запроса без сети: сколько его выполняла сама база. */
async function timed(name, sql, params = []) {
  await c.query(sql, params); // прогрев, чтобы не мерить первый разбор
  const started = Date.now();
  const { rows } = await c.query(sql, params);
  const ms = Date.now() - started;
  console.log(`${String(ms).padStart(5)}мс  строк ${String(rows.length).padStart(4)}  ${name}`);
  return rows;
}

// Кого смотрим глазами родителя: берём того, у кого больше детей.
const parent = (await c.query(
  `select g.user_id, count(*)::int as kids from guardians g
    group by g.user_id order by kids desc limit 1`,
)).rows[0];

console.log(`база: ${host}`);
console.log(`родитель с ${parent?.kids ?? 0} детьми\n`);

await timed('sessionsInRange (календарь Вари)',
  `select s.id as session_id, g.id as group_id, g.title as group_title,
          s.held_on::text, g.starts_at::text, s.status, g.audience,
          (select count(*)::int from attendance a where a.session_id = s.id) as marked,
          (select count(*)::int from attendance a
            where a.session_id = s.id and a.status = 'present') as came,
          (select count(*)::int
             from participants p
             left join children ch on ch.id = p.child_id
             left join users u on u.id = p.user_id
            where ch.archived_at is null
              and ((g.audience = 'adults' and p.user_id is not null and u.attends)
                or (g.audience = 'kids' and p.child_id is not null))
              and (exists (select 1 from preferred_days pd
                            where pd.participant_id = p.id and g.kind = 'lesson'
                              and pd.weekday = g.weekday)
                or exists (select 1 from bookings b
                            where b.session_id = s.id and b.participant_id = p.id
                              and b.status = 'booked'))) as expected,
          (select count(*)::int
             from bookings b
             join participants p on p.id = b.participant_id
             left join children ch on ch.id = p.child_id
             left join users u on u.id = p.user_id
            where b.session_id = s.id and b.status = 'booked'
              and ch.archived_at is null
              and ((g.audience = 'adults' and p.user_id is not null and u.attends)
                or (g.audience = 'kids' and p.child_id is not null))) as booked
     from studio_sessions s
     join studio_groups g on g.id = s.group_id
    where s.held_on between $1::date and $2::date
    order by s.held_on, g.starts_at`,
  [first, last]);

if (parent) {
  await timed('slotsForUser (календарь родителя)',
    `select s.id as session_id, s.held_on::text, g.starts_at::text,
            g.id as group_id, g.title as group_title,
            g.audience, g.kind, g.weekday, g.capacity, g.duration_min,
            coalesce(g.price::text,
                     (select value from settings where key = 'studio_lesson_price')) as price,
            (select count(*)::int from bookings bb
              where bb.session_id = s.id and bb.status = 'booked') as taken,
            p.id as participant_id,
            coalesce(c.name, u.name, 'Я') as who,
            (p.user_id is not null) as is_adult,
            (b.id is not null and b.status = 'booked') as booked,
            (pd.weekday is not null) as preferred
       from studio_sessions s
       join studio_groups g on g.id = s.group_id and g.active
       join participants p
         on (g.audience = 'adults' and p.user_id is not null)
         or (g.audience = 'kids' and p.child_id is not null)
       left join children c on c.id = p.child_id
       left join users u on u.id = p.user_id
       left join bookings b on b.session_id = s.id and b.participant_id = p.id
       left join preferred_days pd on pd.participant_id = p.id and pd.weekday = g.weekday
      where (p.user_id = $1 or p.child_id in (select child_id from guardians where user_id = $1))
        and c.archived_at is null
        and (p.user_id is null or u.attends or g.kind <> 'lesson')
        and s.held_on between $2::date and $3::date
        and s.status <> 'cancelled'
      order by s.held_on, g.starts_at, (p.user_id is not null) desc, who`,
    [parent.user_id, first, last]);
}

await timed('allGroups (экран «Группы»)',
  `select g.id, g.title, g.teacher_id, g.weekday, g.starts_at::text, g.duration_min,
          g.room, g.audience, g.age_hint, g.capacity, g.active,
          g.kind, g.price::text, g.pass_offers, g.starts_on::text, g.ends_on::text, g.weekdays,
          (select count(*)::int from studio_sessions s
            where s.group_id = g.id and s.status <> 'cancelled') as days,
          case when g.kind = 'lesson' then
            (select count(*)::int from participants p
               left join children ch on ch.id = p.child_id
               left join users u on u.id = p.user_id
              where ch.archived_at is null
                and ((g.audience = 'adults' and p.user_id is not null and u.attends)
                  or (g.audience = 'kids' and p.child_id is not null))
                and exists (select 1 from preferred_days pd
                             where pd.participant_id = p.id and pd.weekday = g.weekday))
          else
            (select count(distinct b.participant_id)::int
               from bookings b join studio_sessions s on s.id = b.session_id
              where s.group_id = g.id and b.status = 'booked')
          end as people
     from studio_groups g
    order by g.active desc, g.kind <> 'lesson', g.weekday nulls last, g.starts_at`);

await timed('unclosedBefore (незакрытые дни в журнале)',
  `select s.id as session_id, g.id as group_id, g.title as group_title,
          s.held_on::text, g.starts_at::text, s.status, g.audience,
          (select count(*)::int from participants p
            where ((g.audience = 'adults' and p.user_id is not null)
                or (g.audience = 'kids' and p.child_id is not null))
              and (exists (select 1 from preferred_days pd
                            where pd.participant_id = p.id and g.kind = 'lesson'
                              and pd.weekday = g.weekday)
                or exists (select 1 from bookings b
                            where b.session_id = s.id and b.participant_id = p.id
                              and b.status = 'booked'))) as people,
          0 as marked
     from studio_sessions s
     join studio_groups g on g.id = s.group_id
    where s.held_on < current_date
      and s.held_on > current_date - interval '30 days'
      and s.status <> 'cancelled'
      and not exists (select 1 from attendance a where a.session_id = s.id)
    order by s.held_on desc, g.starts_at`);

const counts = (await c.query(
  `select (select count(*) from studio_sessions where held_on between $1::date and $2::date) as sessions,
          (select count(*) from participants) as participants,
          (select count(*) from bookings) as bookings,
          (select count(*) from attendance) as attendance`,
  [first, last],
)).rows[0];
console.log(`\nв сентябре занятий ${counts.sessions}; всего участников ${counts.participants}, записей ${counts.bookings}, отметок ${counts.attendance}`);
await c.end();
