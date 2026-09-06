#!/usr/bin/env node
// Чистит базу под ноль, оставляя только Варю и Диму: их учётки, роли и
// открытые входы. Всё остальное — дети, семьи, группы, занятия, деньги и
// реестр — удаляется. Цены в settings остаются.
//
//   npm run reset:local            — показать, что уйдёт, ничего не трогая
//   npm run reset:local -- --yes   — удалить
//   npm run reset:prod             — то же самое для боевой базы
//
// По умолчанию скрипт работает только с базой на localhost, чтобы боевую
// нельзя было задеть по невнимательности. Для неё нужен явный флаг
// --allow-remote: он стоит в reset:prod и случайно не окажется нигде ещё.

import pg from 'pg';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('Нет DATABASE_URL. Ожидаю .env.local с локальной базой.');
  process.exit(1);
}

const host = new URL(url).hostname;
const local = host === 'localhost' || host === '127.0.0.1' || host === '::1';
if (!local && !process.argv.includes('--allow-remote')) {
  console.error(`База не локальная (${host}). Без флага --allow-remote скрипт её не тронет.`);
  process.exit(1);
}

/**
 * Кого оставляем. Почты Вари и Димы в локальной и боевой базах разные, а
 * учёток у каждого по нескольку, и какая останется навсегда — ещё не
 * решено. Поэтому здесь перечислены все, а чистка этот вопрос не решает.
 * Список можно задать явно: --keep кто@то,ещё@кто-то
 */
const DEFAULT_KEEP = [
  'varya@re-create.art', 'acidophline@gmail.com',
  'id@perlin.ru', 'dmitriy@perlin.ru', 'dmitriy.perlin@gmail.com',
];

const keepArg = process.argv.find((a) => a.startsWith('--keep='));
const KEEP = keepArg
  ? keepArg.slice(7).split(',').map((e) => e.trim().toLowerCase()).filter(Boolean)
  : DEFAULT_KEEP;

const apply = process.argv.includes('--yes');
const pool = new pg.Pool(
  local ? { connectionString: url } : { connectionString: url, ssl: { rejectUnauthorized: true } },
);
if (!local) console.log(`База не локальная: ${host}\n`);

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

  if (keep.length === 0) {
    console.error('\nНи одна из перечисленных почт в базе не нашлась. Так чистить нельзя.');
    process.exit(1);
  }
  if (!apply) {
    const cmd = local ? 'npm run reset:local -- --yes' : 'npm run reset:prod -- --yes';
    console.log(`\nЭто был просмотр, база не изменилась. Чтобы удалить: ${cmd}`);
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
