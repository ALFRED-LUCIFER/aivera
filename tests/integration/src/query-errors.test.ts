import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { inspect } from 'node:util';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { createDb, DbQueryError, migrateModules, MODULES, withWorkspace, type Db } from '@credalent/db';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// AIV-P0-902 acceptance scenarios against real PostgreSQL, connected as the non-owner aivera_app role.

const rolesSql = readFileSync(createRequire(import.meta.url).resolve('@credalent/db/sql/roles.sql'), 'utf8');

const id = (n: number) => `0190d4a2-0000-7000-8000-${String(n).padStart(12, '0')}`;
const W1 = id(1);
const W2 = id(2);
const NOTE = 'Walked through the eval set';

let container: StartedPostgreSqlContainer;
let admin: Db;
let app: Db;

const urlFor = (role: string) =>
  `postgres://${role}:local_dev_only@${container.getHost()}:${container.getPort()}/${container.getDatabase()}`;

beforeAll(async () => {
  container = await new PostgreSqlContainer('pgvector/pgvector:pg17').withDatabase('aivera').start();
  admin = createDb(container.getConnectionUri(), { max: 1 });
  await admin.$client.unsafe(rolesSql);
  await migrateModules(urlFor('aivera_migrator'), MODULES);
  app = createDb(urlFor('aivera_app'), { max: 1 });
});

afterAll(async () => {
  await app?.$client.end();
  await admin?.$client.end();
  await container?.stop();
});

// Every value is a bound parameter, the note among them.
const insert = (entryId: string, workspaceId: string, action: string) =>
  sql`insert into audit.entry (id, workspace_id, occurred_at, actor_type, action, subject_type, subject_id, note)
    values (${entryId}, ${workspaceId}, now(), 'system', ${action}, 'candidate', ${id(201)}, ${NOTE})`;

async function failure(run: () => Promise<unknown>): Promise<DbQueryError> {
  const error = await run().then(
    () => expect.unreachable('the query succeeded'),
    (e: unknown) => e,
  );
  return error as DbQueryError;
}

function expectNoNote(error: DbQueryError) {
  for (const text of [
    error.message,
    error.stack,
    JSON.stringify(error),
    inspect(error, { showHidden: true, depth: Infinity }),
  ])
    expect(text).not.toContain(NOTE);
  expect(error).toBeInstanceOf(DbQueryError);
}

// SAFETY: mutation check: removed all redactErrors calls in packages/db/src/client.ts -> all four tests failed (the note in the message, stack and JSON)
// SAFETY: mutation check: removed only the PostgresJsSession.transaction redaction -> "a lost connection" failed (the note in the raw PostgresError's hidden parameters)
describe('Scenario Outline: Every failure kind is redacted', () => {
  it('a check constraint violation (23514) keeps its code and constraint name', async () => {
    const error = await failure(() => withWorkspace(app, W1, (tx) => tx.execute(insert(id(301), W1, 'not.an.action'))));
    expectNoNote(error);
    expect(error).toMatchObject({ code: '23514', constraint: 'entry_action_check' });
    expect(error.query).toContain('insert into audit.entry');
  });

  it('a row-level security refusal (42501)', async () => {
    const error = await failure(() =>
      withWorkspace(app, W1, (tx) => tx.execute(insert(id(302), W2, 'rubric.approved'))),
    );
    expectNoNote(error);
    expect(error.code).toBe('42501');
  });

  it('a unique violation (23505), and the caller can branch on code and constraint', async () => {
    await withWorkspace(app, W1, (tx) => tx.execute(insert(id(303), W1, 'rubric.approved')));
    const error = await failure(() =>
      withWorkspace(app, W1, (tx) => tx.execute(insert(id(303), W1, 'rubric.approved'))),
    );
    expectNoNote(error);
    expect(error).toMatchObject({ code: '23505', constraint: 'entry_pkey' });
  });

  it('a lost connection', async () => {
    const own = createDb(urlFor('aivera_app'), { max: 1 });
    try {
      // The backend is terminated while the query that carries the note runs.
      const error = await failure(() =>
        withWorkspace(own, W1, (tx) => tx.execute(sql`select pg_terminate_backend(pg_backend_pid()), ${NOTE}::text`)),
      );
      expectNoNote(error);
      expect(error.code).toBe('57P01');
    } finally {
      await own.$client.end();
    }
  });

  // SAFETY: mutation check: removed only the PostgresJsTransaction.transaction redaction -> this test failed (the note in the raw PostgresError's hidden parameters)
  // postgres-js rejects a savepoint whose callback swallowed a failed query with that query's raw error.
  it('a nested transaction (savepoint) that failed inside the outer transaction', async () => {
    const error = await withWorkspace(app, W1, (tx) =>
      failure(() =>
        tx.transaction(async (savepoint) => {
          await savepoint.execute(insert(id(304), W1, 'not.an.action')).catch(() => {});
        }),
      ),
    );
    expectNoNote(error);
    expect(error).toMatchObject({ code: '23514', constraint: 'entry_action_check' });
  });
});

// AIV-P1-088: a lock wait on an application connection ends with an error instead of holding a pooled connection.
describe('Scenario: A lock wait ends with an error', () => {
  // SAFETY: mutation check: lock_timeout removed -> this test failed (Test timed out in 20000ms: the update kept waiting)
  it('an update of a row another transaction holds fails with 55P03 after the lock timeout, without its parameters', async () => {
    await admin.execute(sql`create table public.contended (id int primary key, note text)`);
    await admin.execute(sql`insert into public.contended values (1, null)`);
    await admin.execute(sql`grant select, update on public.contended to aivera_app`);
    const held = Promise.withResolvers<void>();
    const locked = Promise.withResolvers<void>();
    const holder = admin.transaction(async (tx) => {
      await tx.execute(sql`select id from public.contended where id = 1 for update`);
      locked.resolve();
      await held.promise;
    });
    await locked.promise;
    const started = Date.now();
    try {
      const error = await failure(() => app.execute(sql`update public.contended set note = ${NOTE} where id = 1`));
      expectNoNote(error);
      expect(error.code).toBe('55P03');
      expect(Date.now() - started).toBeGreaterThanOrEqual(9_000);
    } finally {
      held.resolve();
      await holder;
    }
  }, 20_000);
});

const timeouts = async (db: Db) => [
  ...(await db.execute(
    sql`select current_setting('lock_timeout') as lock, current_setting('statement_timeout') as statement`,
  )),
];

describe('Application connections carry the timeouts; the migrator does not', () => {
  it('createDb sets lock_timeout 10s and statement_timeout 1min, and timeouts: false leaves both off', async () => {
    expect(await timeouts(app)).toEqual([{ lock: '10s', statement: '1min' }]);
    const migrator = createDb(urlFor('aivera_migrator'), { max: 1, timeouts: false });
    try {
      expect(await timeouts(migrator)).toEqual([{ lock: '0', statement: '0' }]);
    } finally {
      await migrator.$client.end();
    }
  });
});
