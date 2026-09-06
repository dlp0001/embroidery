import pg from 'pg';
import { pgConfig } from './pg-config';
import { STUDIO_TZ } from './time';

// Один пул на процесс. В dev Next перезагружает модули, поэтому держим в globalThis.
const globalForDb = globalThis as unknown as { _pool?: pg.Pool };

export const pool =
  globalForDb._pool ??
  new pg.Pool({
    ...pgConfig(process.env.DATABASE_URL),
    max: 5,
    idleTimeoutMillis: 30_000,
  });

// «Сегодня» у базы должно совпадать с «сегодня» у студии, иначе между
// полуночью и утром current_date отстаёт на день от того, что видит человек.
pool.on('connect', (client) => {
  client.query(`set time zone '${STUDIO_TZ}'`).catch((err) => {
    console.error('не удалось выставить часовой пояс', err);
  });
});

if (process.env.NODE_ENV !== 'production') globalForDb._pool = pool;

// Включается переменной DB_TRACE=1: печатает каждый запрос и его время.
// Нужен, чтобы искать не «где-то медленно», а конкретное место.
const TRACE = process.env.DB_TRACE === '1';

function trace(text: string, started: number, rows: number): void {
  const ms = Date.now() - started;
  const short = text.trim().replace(/\s+/g, ' ').slice(0, 70);
  console.log(`[db] ${String(ms).padStart(5)}мс  строк ${String(rows).padStart(4)}  ${short}`);
}

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const started = Date.now();
  const res = await pool.query<T>(text, params);
  if (TRACE) trace(text, started, res.rowCount ?? 0);
  return res.rows;
}

export async function one<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}

export async function tx<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const started = Date.now();
  const client = await pool.connect();
  if (TRACE) console.log(`[db] ${Date.now() - started}мс  взят клиент из пула`);
  try {
    await client.query('begin');
    const result = await fn(client);
    await client.query('commit');
    if (TRACE) console.log(`[db] ${Date.now() - started}мс  транзакция целиком`);
    return result;
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
  }
}
