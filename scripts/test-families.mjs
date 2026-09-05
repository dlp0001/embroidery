// Тестовые семьи. Все на домене @test.re-create.art, чтобы удалить одним махом.
// Завести:  npm run families
// Удалить:  npm run families -- --remove
// В группу: npm run families -- --group 'Младшие'
import pg from 'pg';

function pgConfig(connectionString) {
  let local = false;
  try {
    const host = new URL(connectionString).hostname;
    local = host === 'localhost' || host === '127.0.0.1';
  } catch {}
  return local ? { connectionString } : { connectionString, ssl: { rejectUnauthorized: true } };
}

const DOMAIN = 'test.re-create.art';

const FAMILIES = [
  { parent: 'Таня Либерман', login: 'tanya', children: ['Яша Либерман', 'Мири Либерман', 'Либи Либерман'] },
  { parent: 'Игорь Дубнов',  login: 'igor',  children: ['Агата Дубнов', 'Тим Дубнов'] },
  { parent: 'Алла',          login: 'alla',  children: ['Элай'] },
];

const args = process.argv.slice(2);
const remove = args.includes('--remove');
const groupTitle = args.includes('--group') ? args[args.indexOf('--group') + 1] : null;

const c = new pg.Client(pgConfig(process.env.DATABASE_URL));
await c.connect();

if (remove) {
  const { rows } = await c.query(
    `select id, email from users where email like '%@' || $1`, [DOMAIN]);
  if (rows.length === 0) {
    console.log('тестовых семей в базе нет');
  } else {
    // Дети уходят вместе с опекунами: удаляем тех, у кого других опекунов не осталось.
    const { rowCount: kids } = await c.query(
      `delete from children ch
        where exists (select 1 from guardians g join users u on u.id = g.user_id
                       where g.child_id = ch.id and u.email like '%@' || $1)
          and not exists (select 1 from guardians g join users u on u.id = g.user_id
                           where g.child_id = ch.id and u.email not like '%@' || $1)`,
      [DOMAIN]);
    const { rowCount: parents } = await c.query(
      `delete from users where email like '%@' || $1`, [DOMAIN]);
    console.log(`удалено: родителей ${parents}, детей ${kids}`);
  }
  await c.end();
  process.exit(0);
}

let group = null;
if (groupTitle) {
  const { rows } = await c.query('select id, title from studio_groups where title = $1', [groupTitle]);
  if (rows.length === 0) {
    console.error(`группы «${groupTitle}» нет`);
    await c.end();
    process.exit(1);
  }
  group = rows[0];
}

for (const fam of FAMILIES) {
  const email = `${fam.login}@${DOMAIN}`;
  await c.query('begin');
  const { rows: u } = await c.query(
    `insert into users (email, name) values ($1, $2)
     on conflict (email) do update set name = excluded.name returning id`,
    [email, fam.parent]);
  const parentId = u[0].id;
  await c.query(`insert into user_roles (user_id, role) values ($1, 'parent') on conflict do nothing`, [parentId]);
  await c.query('insert into participants (user_id) values ($1) on conflict do nothing', [parentId]);

  const kids = [];
  for (const name of fam.children) {
    // Повторный запуск не должен плодить одинаковых детей у того же родителя.
    const { rows: existing } = await c.query(
      `select ch.id from children ch join guardians g on g.child_id = ch.id
        where g.user_id = $1 and ch.name = $2`, [parentId, name]);
    let childId = existing[0]?.id;
    if (!childId) {
      const { rows } = await c.query('insert into children (name) values ($1) returning id', [name]);
      childId = rows[0].id;
      await c.query('insert into guardians (child_id, user_id) values ($1, $2)', [childId, parentId]);
      await c.query('insert into participants (child_id) values ($1)', [childId]);
    }
    const { rows: p } = await c.query('select id from participants where child_id = $1', [childId]);
    kids.push(p[0].id);
  }

  if (group) {
    for (const participantId of kids) {
      await c.query(
        `insert into studio_members (group_id, participant_id) values ($1, $2)
         on conflict do nothing`, [group.id, participantId]);
    }
  }
  await c.query('commit');
  console.log(`${fam.parent} · ${email} · детей ${fam.children.length}${group ? ` · в группу «${group.title}»` : ''}`);
}

const n = await c.query(
  `select count(*)::int as n from users where email like '%@' || $1`, [DOMAIN]);
console.log(`\nвсего тестовых родителей в базе: ${n.rows[0].n}`);
console.log('удалить всё: npm run families -- --remove');
await c.end();
