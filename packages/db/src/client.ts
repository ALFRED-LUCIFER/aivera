import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

export type Db = ReturnType<typeof drizzle>;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/** A Drizzle client over postgres-js. The caller owns the connection and closes it with `$client.end()`. */
export function createDb(url: string, options: { max?: number } = {}): Db {
  return drizzle(postgres(url, { max: options.max ?? 10, onnotice: () => {} }));
}
