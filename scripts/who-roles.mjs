// Кто с какими ролями. Только читает. С аргументом — ищет по почте
// или имени, включая тех, у кого ролей нет вовсе.
import pg from 'pg';

const needle = process.argv.slice(2).find((a) => !a.startsWith('-')) ?? null;

const url = process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL не задан'); process.exit(1); }
const host = new URL(url).hostname;
const local = host === 'localhost' || host === '127.0.0.1';

const c = new pg.Client(local ? { connectionString: url } : { connectionString: url, ssl: { rejectUnauthorized: true } });
await c.connect();
const { rows } = await c.query(
  `select u.email, coalesce(u.name, '—') as name, u.created_at::date::text as since,
          coalesce(array_agg(r.role order by r.role) filter (where r.role is not null), '{}') as roles,
          (select count(*)::int from sessions s
            where s.user_id = u.id and s.expires_at > now()) as sessions
     from users u left join user_roles r on r.user_id = u.id
    where ($1::text is null and exists (select 1 from user_roles x where x.user_id = u.id))
       or ($1::text is not null
           and (u.email ilike '%' || $1 || '%' or coalesce(u.name, '') ilike '%' || $1 || '%'))
    group by u.id, u.email, u.name, u.created_at
    order by u.email`,
  [needle],
);
console.log(`база: ${host}${needle ? `, поиск «${needle}»` : ''}`);
if (rows.length === 0) console.log('  никого не нашлось');
for (const r of rows) {
  const roles = r.roles.length > 0 ? r.roles.join(', ') : 'ролей нет';
  console.log(`  ${r.email.padEnd(32)} ${r.name.padEnd(16)} ${roles.padEnd(20)} c ${r.since}, живых входов ${r.sessions}`);
}
await c.end();
