// Прогон миграций: применяет db/migrations/*.sql по порядку, один раз каждую.
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const dir = join(dirname(fileURLToPath(import.meta.url)), 'migrations');
const url = process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL не задан'); process.exit(1); }

const client = new pg.Client({ connectionString: url });
await client.connect();
await client.query(`create table if not exists _migrations (
  name text primary key, applied_at timestamptz not null default now())`);

const done = new Set((await client.query('select name from _migrations')).rows.map((r) => r.name));
const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();

let applied = 0;
for (const f of files) {
  if (done.has(f)) continue;
  const sql = await readFile(join(dir, f), 'utf8');
  try {
    await client.query('begin');
    await client.query(sql);
    await client.query('insert into _migrations(name) values ($1)', [f]);
    await client.query('commit');
    console.log('применена', f);
    applied++;
  } catch (err) {
    await client.query('rollback');
    console.error('упала', f, '\n', err.message);
    process.exit(1);
  }
}
console.log(applied ? `готово, ${applied} шт.` : 'нечего применять');
await client.end();
