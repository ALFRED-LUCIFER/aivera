import { sql } from 'drizzle-orm';
import { DrizzleQueryError } from 'drizzle-orm/errors';
import { drizzle, PostgresJsSession, PostgresJsTransaction } from 'drizzle-orm/postgres-js';
import { PgPreparedQuery } from 'drizzle-orm/pg-core/session';
import postgres from 'postgres';
import { entraToken } from './entraToken.ts';

export type Db = ReturnType<typeof drizzle>;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/**
 * A failed query that is safe to log (AGENTS.md 1.2): the SQL text with its `$n` placeholders, the PostgreSQL error
 * `code`, `constraint` and `routine`, never the bound values. The server's message and detail are dropped too, since
 * some (invalid input, duplicate key detail) echo a value. `routine` tells a privilege refusal from a trigger's RAISE.
 */
export class DbQueryError extends Error {
  override name = 'DbQueryError';
  readonly query: string;
  readonly code: string | undefined;
  readonly constraint: string | undefined;
  readonly routine: string | undefined;

  constructor(query: string, cause: unknown) {
    const { code, constraint_name: constraint, routine } = (cause ?? {}) as Record<string, string | undefined>;
    super(`Failed query (${code ?? 'no code'}${constraint ? `, ${constraint}` : ''}): ${query}`);
    this.query = query;
    this.code = code;
    this.constraint = constraint;
    this.routine = routine;
  }
}

function redact(error: unknown): unknown {
  if (error instanceof DrizzleQueryError) return new DbQueryError(error.query, error.cause);
  // postgres-js attaches the query and its values (hidden) to errors that bypass drizzle's wrapper and reject the
  // transaction or savepoint itself: a lost connection, BEGIN or COMMIT failing, a failed query the callback swallowed.
  if (error instanceof Error && 'parameters' in error)
    return new DbQueryError(String(Reflect.get(error, 'query')), error);
  return error;
}

// drizzle-orm 0.45 has no hook for query errors and builds DrizzleQueryError with the params in its message and as a
// property. Every query, in or out of a transaction and in the migrator, runs through queryWithCache; the two
// transaction methods (outer and savepoint) cover the rest.
function redactErrors(prototype: object, method: string) {
  const target = prototype as Record<string, (...args: unknown[]) => Promise<unknown>>;
  const original = target[method];
  // A drizzle upgrade must run tests/integration/src/query-errors.test.ts; this guard only proves the methods exist.
  if (typeof original !== 'function') throw new Error(`drizzle-orm changed: ${method} no longer redacts query errors`);
  target[method] = function (this: unknown, ...args: unknown[]) {
    return original.apply(this, args).catch((error: unknown) => {
      throw redact(error);
    });
  };
}
redactErrors(PgPreparedQuery.prototype, 'queryWithCache');
redactErrors(PostgresJsSession.prototype, 'transaction');
redactErrors(PostgresJsTransaction.prototype, 'transaction');

// shortcut: $client (raw postgres-js) is not redacted; use it only for role setup and end(); add a lint restriction once app code needs raw SQL
/**
 * Sent at connection start (milliseconds): a lock wait ends with 55P03 and a runaway statement with 57014, a
 * DbQueryError without the bound values, instead of holding a pooled connection for ever (AIV-P1-088). Neither counts
 * the time a transaction spends between statements, so a delivery that calls a model inside its transaction still works.
 */
const APP_TIMEOUTS = { lock_timeout: 10_000, statement_timeout: 60_000 };

/**
 * A Drizzle client over postgres-js. The caller owns the connection and closes it with `$client.end()`.
 * A URL without a password signs in with the managed identity's Entra token (Azure, ADR-008), always over verified
 * TLS because the token travels as the password. Without an identity endpoint the first connection fails clearly.
 * `timeouts: false` is for the migrator only: a migration may wait for its locks and run as long as it needs.
 */
export function createDb(url: string, options: { max?: number; clientId?: string; timeouts?: false } = {}): Db {
  // `clientId` picks a second identity in one process (the worker's relay, AIV-P0-015); default AZURE_CLIENT_ID.
  const env = options.clientId ? { ...process.env, AZURE_CLIENT_ID: options.clientId } : process.env;
  const entra = new URL(url).password ? {} : { password: () => entraToken(env), ssl: 'verify-full' as const };
  const connection = options.timeouts === false ? {} : { connection: APP_TIMEOUTS };
  return drizzle(postgres(url, { max: options.max ?? 10, onnotice: () => {}, ...connection, ...entra }));
}

/** True when `select 1` answers within `timeoutMs`; never throws (readiness probes). */
export async function isReachable(db: Db, timeoutMs: number): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<false>((resolve) => (timer = setTimeout(resolve, timeoutMs, false)));
  try {
    return await Promise.race([db.execute(sql`select 1`).then(() => true), timeout]);
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
