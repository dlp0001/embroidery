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

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const res = await pool.query<T>(text, params);
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
  const client = await pool.connect();
  try {
    await client.query('begin');
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
  }
}
