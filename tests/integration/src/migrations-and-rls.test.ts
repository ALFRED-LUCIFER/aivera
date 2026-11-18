import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { createDb, migrateModules, withWorkspace, type Db, type MigratableModule } from '@aivera/db';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { notes } from '../fixtures/modules/fixture_notes/src/infrastructure/schema.ts';

const W1 = '0190d4a2-0000-7000-8000-000000000001';
const W2 = '0190d4a2-0000-7000-8000-000000000002';

const fixtureModule: MigratableModule = {
  name: 'fixture_notes',
  dir: join(import.meta.dirname, '..', 'fixtures', 'modules', 'fixture_notes'),
};
const rolesSql = readFileSync(createRequire(import.meta.url).resolve('@aivera/db/sql/roles.sql'), 'utf8');

let container: StartedPostgreSqlContainer;
let admin: Db;
let app: Db;
let migratorUrl: string;

const urlFor = (user: string) =>
  `postgres://${user}:local_dev_only@${container.getHost()}:${container.getPort()}/${container.getDatabase()}`;

beforeAll(async () => {
  container = await new PostgreSqlContainer('pgvector/pgvector:pg17').withDatabase('aivera').start();
  admin = createDb(container.getConnectionUri(), { max: 1 });
  await admin.$client.unsafe(rolesSql);
  migratorUrl = urlFor('aivera_migrator');
  await migrateModules(migratorUrl, [fixtureModule]);
  app = createDb(urlFor('aivera_app'), { max: 1 }); // one connection, so the reuse case below is real
});

afterAll(async () => {
  await app?.$client.end();
  await admin?.$client.end();
  await container?.stop();
});

const appliedCount = async () =>
  Number((await admin.execute<{ n: string }>(sql`select count(*) as n from migrations.fixture_notes`))[0]?.n);

describe('Drizzle Kit migrations per module (ADR-004)', () => {
  it("applies the module's migrations to its own schema, tracked in its own table", async () => {
    expect(await appliedCount()).toBe(2);
    const [table] = await admin.execute<{ owner: string; rls: boolean; forced: boolean }>(sql`
      select tableowner as owner, c.relrowsecurity as rls, c.relforcerowsecurity as forced
      from pg_tables t join pg_class c on c.relname = t.tablename
      where t.schemaname = 'fixture_notes' and t.tablename = 'notes'`);
    expect(table).toEqual({ owner: 'aivera_migrator', rls: true, forced: true });
  });

  it('a second run applies nothing', async () => {
    await migrateModules(migratorUrl, [fixtureModule]);
    expect(await appliedCount()).toBe(2);
  });

  // SAFETY: mutation check: removed the three REVOKE statements in migrateModules -> this test failed
  it('the app role can neither read nor change the migrations journal', async () => {
    await expect(app.execute(sql`select count(*) from migrations.fixture_notes`)).rejects.toMatchObject({
      code: '42501',
    });
    await expect(app.execute(sql`delete from migrations.fixture_notes`)).rejects.toMatchObject({ code: '42501' });
  });
});

describe('workspace isolation at the database (ADR-005)', () => {
  beforeAll(async () => {
    await withWorkspace(app, W1, (tx) =>
      tx.insert(notes).values({ id: crypto.randomUUID(), workspaceId: W1, body: 'w1' }),
    );
    await withWorkspace(app, W2, (tx) =>
      tx.insert(notes).values({ id: crypto.randomUUID(), workspaceId: W2, body: 'w2' }),
    );
  });

  // SAFETY: mutation check: removed ENABLE/FORCE ROW LEVEL SECURITY from the fixture migrations -> this test failed (saw w1 and w2)
  it('a query with no WHERE clause inside the W1 transaction returns only W1 rows', async () => {
    const rows = await withWorkspace(app, W1, (tx) => tx.select({ body: notes.body }).from(notes));
    expect(rows).toEqual([{ body: 'w1' }]);
  });

  it('with no workspace set, on a connection that already ran a workspace transaction, nothing is returned', async () => {
    expect(await app.select().from(notes)).toEqual([]);
  });

  it("a write into another workspace is refused by the policy's WITH CHECK", async () => {
    await expect(
      withWorkspace(app, W1, (tx) => tx.insert(notes).values({ id: crypto.randomUUID(), workspaceId: W2, body: 'x' })),
    ).rejects.toThrow();
  });
});
