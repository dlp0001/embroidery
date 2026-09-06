#!/usr/bin/env node
// Чистит локальную базу под ноль, оставляя только Варю и Диму: их учётки,
// роли и открытые входы. Всё остальное — дети, семьи, группы, занятия,
// деньги и реестр — удаляется. Цены в settings остаются.
//
//   npm run reset:local            — показать, что уйдёт, ничего не трогая
//   npm run reset:local -- --yes   — удалить
//
// Работает только с базой на localhost. Боевую базу трогать нельзя, и
// скрипт это проверяет сам, а не полагается на внимательность.

import pg from 'pg';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('Нет DATABASE_URL. Ожидаю .env.local с локальной базой.');
  process.exit(1);
}

const host = new URL(url).hostname;
if (host !== 'localhost' && host !== '127.0.0.1' && host !== '::1') {
  console.error(`База не локальная (${host}). Скрипт работает только с localhost.`);
  process.exit(1);
}

/** Кого оставляем. Всё, что не отсюда, будет удалено. */
const KEEP = [
  'varya@re-create.art',
  // Учёток Димы две, и какая из них останется навсегда — ещё не решено,
  // поэтому чистка этот вопрос не решает: остаются обе.
  'id@perlin.ru',
  'dmitriy.perlin@gmail.com',
];

const apply = process.argv.includes('--yes');
const pool = new pg.Pool({ connectionString: url });

// Порядок важен только там, где нет каскада; лишний delete не мешает.
const WIPE = [
  'money_events', 'charges', 'passes', 'payments',
  'attendance', 'bookings', 'studio_sessions', 'studio_members', 'studio_groups',
  'preferred_days', 'participants', 'guardians', 'children',
  'enrollments', 'lessons', 'courses', 'consents', 'login_codes',
];

const client = await pool.connect();
try {
  const { rows: keep } = await client.query(
    `select u.id, u.email, u.name, coalesce(string_agg(r.role, ', '), '—') as roles
       from users u left join user_roles r on r.user_id = u.id
      where u.email = any($1::text[])
      group by u.id, u.email, u.name order by u.email`,
    [KEEP],
  );
  const { rows: drop } = await client.query(
    `select u.email, u.name from users u where not (u.email = any($1::text[])) order by u.email`,
    [KEEP],
  );

  console.log('Останутся:');
  for (const u of keep) console.log(`  ${u.email} · ${u.name ?? 'без имени'} · ${u.roles}`);
  if (keep.length === 0) console.log('  никого — проверь список KEEP, так чистить нельзя');
  console.log(`Уйдут учётки: ${drop.length}`);
  for (const u of drop) console.log(`  ${u.email} · ${u.name ?? 'без имени'}`);

  console.log('\nСтроки в таблицах:');
  for (const t of WIPE) {
    const { rows } = await client.query(`select count(*)::int as n from ${t}`);
    if (rows[0].n > 0) console.log(`  ${t}: ${rows[0].n}`);
  }

  if (keep.length === 0) process.exit(1);
  if (!apply) {
    console.log('\nЭто был просмотр. Чтобы удалить: npm run reset:local -- --yes');
    process.exit(0);
  }

  await client.query('begin');
  for (const t of WIPE) await client.query(`delete from ${t}`);
  await client.query('delete from user_roles where not (user_id = any($1::uuid[]))', [keep.map((u) => u.id)]);
  await client.query('delete from sessions where not (user_id = any($1::uuid[]))', [keep.map((u) => u.id)]);
  await client.query('delete from users where not (id = any($1::uuid[]))', [keep.map((u) => u.id)]);
  await client.query('commit');

  console.log(`\nБаза очищена. Осталось учёток: ${keep.length}.`);
} catch (e) {
  await client.query('rollback').catch(() => {});
  console.error(e.message);
  process.exit(1);
} finally {
  client.release();
  await pool.end();
}
