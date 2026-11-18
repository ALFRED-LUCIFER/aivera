import { DrizzleQueryError } from 'drizzle-orm/errors';
import { drizzle, PostgresJsSession } from 'drizzle-orm/postgres-js';
import { PgPreparedQuery } from 'drizzle-orm/pg-core/session';
import postgres from 'postgres';

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
  // transaction itself: a lost connection, BEGIN or COMMIT failing.
  if (error instanceof Error && 'parameters' in error)
    return new DbQueryError(String(Reflect.get(error, 'query')), error);
  return error;
}

// drizzle-orm 0.45 has no hook for query errors and builds DrizzleQueryError with the params in its message and as a
// property. Every query, in or out of a transaction and in the migrator, runs through queryWithCache; transaction
// covers the rest. shortcut: a raw savepoint error is redacted only when it leaves the outer transaction, wrap
// PostgresJsTransaction.transaction too if code starts catching errors from nested transactions.
function redactErrors(prototype: object, method: string) {
  const target = prototype as Record<string, (...args: unknown[]) => Promise<unknown>>;
  const original = target[method];
  if (typeof original !== 'function') throw new Error(`drizzle-orm changed: ${method} no longer redacts query errors`);
  target[method] = function (this: unknown, ...args: unknown[]) {
    return original.apply(this, args).catch((error: unknown) => {
      throw redact(error);
    });
  };
}
redactErrors(PgPreparedQuery.prototype, 'queryWithCache');
redactErrors(PostgresJsSession.prototype, 'transaction');

/** A Drizzle client over postgres-js. The caller owns the connection and closes it with `$client.end()`. */
export function createDb(url: string, options: { max?: number } = {}): Db {
  return drizzle(postgres(url, { max: options.max ?? 10, onnotice: () => {} }));
}
