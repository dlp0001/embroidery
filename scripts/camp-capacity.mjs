// Сколько человек берут в день на смену. Столько же видно родителю
// в кабинете: «мест: 5».
//
// node --env-file-if-exists=.env.local scripts/camp-capacity.mjs 8
import pg from 'pg';

const args = process.argv.slice(2);
const allowRemote = args.includes('--allow-remote');
const n = args.map(Number).find((x) => Number.isInteger(x) && x > 0);
if (!n) { console.error('нужно число мест: 8'); process.exit(1); }

const url = process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL не задан'); process.exit(1); }
const host = new URL(url).hostname;
const local = host === 'localhost' || host === '127.0.0.1';
if (!local && !allowRemote) {
  console.error(`База не локальная (${host}). Нужен флаг --allow-remote.`);
  process.exit(1);
}

const c = new pg.Client(local ? { connectionString: url } : { connectionString: url, ssl: { rejectUnauthorized: true } });
await c.connect();
const { rows } = await c.query(
  `update studio_groups set capacity = $1
    where kind <> 'lesson' and active
      and (ends_on is null or ends_on >= current_date)
    returning title, capacity`,
  [n],
);
if (rows.length === 0) console.log('действующих смен нет');
for (const r of rows) console.log(`${r.title}: мест в день ${r.capacity}`);
await c.end();
