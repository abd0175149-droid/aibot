import { drizzle } from 'drizzle-orm/postgres-js';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { schema } from './schema.js';

export type Db = PostgresJsDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

let _sql: postgres.Sql | null = null;
let _db: Db | null = null;

export function getDb(): Db {
  if (_db) return _db;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL غير مضبوط — لا إقلاع بلا قاعدة');
  _sql = postgres(url, {
    max: Number(process.env.PG_POOL_MAX ?? 10),
    idle_timeout: 30,
    connect_timeout: 10,
    // الأسماء العربيّة في الرسائل والملاحظات تحتاج UTF-8 صراحةً
    connection: { application_name: 'aibot' },
  });
  _db = drizzle(_sql, { schema });
  return _db;
}

export async function closeDb(): Promise<void> {
  await _sql?.end({ timeout: 5 });
  _sql = null;
  _db = null;
}

export async function pingDb(): Promise<boolean> {
  try {
    await getDb().execute(/* sql */ `select 1`);
    return true;
  } catch {
    return false;
  }
}
