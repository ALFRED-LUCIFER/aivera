import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { createDb, migrateModules, MODULES, type Db } from '@credalent/db';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// AIV-P0-932. Azure refuses CREATE EXTENSION to a non-admin even with IF NOT EXISTS and vector present (42501). An event
// trigger that refuses every CREATE EXTENSION plays that check on plain PostgreSQL: it fires for the no-op too.

const rolesSql = readFileSync(createRequire(import.meta.url).resolve('@credalent/db/sql/roles.sql'), 'utf8');
const search = MODULES.filter((m) => m.name === 'search');

let container: StartedPostgreSqlContainer;
let admin: Db;

beforeAll(async () => {
  container = await new PostgreSqlContainer('pgvector/pgvector:pg17').withDatabase('aivera').start();
  admin = createDb(container.getConnectionUri(), { max: 1 });
  await admin.$client.unsafe(rolesSql); // creates vector as the superuser, as bootstrap-roles.sql does on Azure
  await admin.$client.unsafe(`
    CREATE FUNCTION refuse_create_extension() RETURNS event_trigger LANGUAGE plpgsql AS
      $f$ BEGIN RAISE EXCEPTION 'CREATE EXTENSION executed'; END $f$;
    CREATE EVENT TRIGGER refuse_create_extension ON ddl_command_start WHEN TAG IN ('CREATE EXTENSION')
      EXECUTE FUNCTION refuse_create_extension();`);
});

afterAll(async () => {
  await admin?.$client.end();
  await container?.stop();
});

describe('Scenario: A deploy where vector already exists applies the search migrations', () => {
  // SAFETY: mutation check: restored `CREATE EXTENSION IF NOT EXISTS vector;` in 0000_vector_extension.sql -> this test failed
  it('migrates search as aivera_migrator without executing CREATE EXTENSION', async () => {
    const url = `postgres://aivera_migrator:local_dev_only@${container.getHost()}:${container.getPort()}/aivera`;
    await expect(migrateModules(url, search)).resolves.toBeUndefined();
    const [column] = await admin.execute<{ udt_name: string }>(
      sql`select udt_name from information_schema.columns where table_schema = 'search' and table_name = 'chunk' and column_name = 'embedding'`,
    );
    expect(column?.udt_name).toBe('halfvec');
  });
});
