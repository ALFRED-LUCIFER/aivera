import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { createDb, withWorkspace, type Db } from '@aivera/db';
import { WorkspaceError, type MemberStatus, type Role, type WorkspacesContract } from '@aivera/workspaces';
import { createWorkspaces } from '@aivera/workspaces/composition';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// AIV-P0-008 acceptance scenarios against real PostgreSQL, connected as the non-owner aivera_app role (ADR-004, ADR-005).

const rolesSql = readFileSync(createRequire(import.meta.url).resolve('@aivera/db/sql/roles.sql'), 'utf8');
const dbCli = join(import.meta.dirname, '..', '..', '..', 'packages', 'db', 'src', 'cli.ts');

// Synthetic user ids (opaque ids from the identity module).
const ALEX = '0190d4a2-0000-7000-8000-00000000a1e1';
const user = (n: number) => `0190d4a2-0000-7000-8000-${String(n).padStart(12, '0')}`;

let container: StartedPostgreSqlContainer;
let admin: Db;
let app: Db;
let workspaces: WorkspacesContract;

const urlFor = (role: string) =>
  `postgres://${role}:local_dev_only@${container.getHost()}:${container.getPort()}/${container.getDatabase()}`;

/** `pnpm db:migrate`: the same CLI the root script runs, against the test container. */
const dbMigrate = () =>
  execFileSync(process.execPath, [dbCli, 'migrate'], {
    env: { ...process.env, DATABASE_MIGRATOR_URL: urlFor('aivera_migrator') },
  });

const newWorkspace = (name: string) =>
  workspaces.createWorkspace({
    name,
    company: name,
    hiringFocus: 'AI and LLM engineering',
    synthetic: true,
    creatorUserId: ALEX,
  });

/** Adds a member directly, as aivera_app inside the workspace (inviting is AIV-P1-003). */
const addMember = (workspaceId: string, userId: string, role: Role, status: MemberStatus = 'active') =>
  withWorkspace(app, workspaceId, (tx) =>
    tx.execute(
      sql`insert into workspaces.member (workspace_id, user_id, role, status) values (${workspaceId}, ${userId}, ${role}, ${status})`,
    ),
  );

beforeAll(async () => {
  container = await new PostgreSqlContainer('pgvector/pgvector:pg17').withDatabase('aivera').start();
  admin = createDb(container.getConnectionUri(), { max: 1 });
  await admin.$client.unsafe(rolesSql);
  dbMigrate();
  app = createDb(urlFor('aivera_app'), { max: 1 }); // one connection, so the reused-connection case below is real
  workspaces = createWorkspaces(app);
});

afterAll(async () => {
  await app?.$client.end();
  await admin?.$client.end();
  await container?.stop();
});

const applied = async () =>
  Number((await admin.execute<{ n: string }>(sql`select count(*) as n from migrations.workspaces`))[0]?.n);

describe('Scenario: Migrations are forward-only and per schema', () => {
  it('the workspaces schema has its own migrations table and a second pnpm db:migrate applies nothing', async () => {
    expect(await applied()).toBe(2);
    dbMigrate();
    expect(await applied()).toBe(2);
  });

  it('both tables are owned by aivera_migrator with row-level security enabled and forced', async () => {
    const tables = await admin.execute<{ name: string; owner: string; rls: boolean; forced: boolean }>(sql`
      select t.tablename as name, t.tableowner as owner, c.relrowsecurity as rls, c.relforcerowsecurity as forced
      from pg_tables t join pg_class c on c.oid = format('%I.%I', t.schemaname, t.tablename)::regclass
      where t.schemaname = 'workspaces' order by name`);
    expect([...tables]).toEqual([
      { name: 'member', owner: 'aivera_migrator', rls: true, forced: true },
      { name: 'workspace', owner: 'aivera_migrator', rls: true, forced: true },
    ]);
  });
});

describe('Scenario: Creating a workspace makes the creator its admin', () => {
  it('"Alex Recruiter" creates "Demo Hiring Co" and is a member with role admin', async () => {
    const created = await newWorkspace('Demo Hiring Co');
    expect(created).toMatchObject({ name: 'Demo Hiring Co', hiringFocus: 'AI and LLM engineering', synthetic: true });

    const rows = await withWorkspace(app, created.id, (tx) =>
      tx.execute<{ name: string }>(sql`select name from workspaces.workspace`),
    );
    expect([...rows]).toEqual([{ name: 'Demo Hiring Co' }]);
    expect(await workspaces.getMembership(ALEX, created.id)).toEqual({
      userId: ALEX,
      workspaceId: created.id,
      role: 'admin',
      status: 'active',
    });
  });
});

describe('Scenario: Members of another workspace are invisible at the database', () => {
  let w1: string;
  let w2: string;

  beforeAll(async () => {
    w1 = (await newWorkspace('W1')).id;
    w2 = (await newWorkspace('W2')).id;
    await addMember(w1, user(11), 'recruiter');
    await addMember(w1, user(12), 'interviewer');
    await addMember(w2, user(21), 'hiring_owner');
  });

  // SAFETY: mutation check: NO FORCE + DISABLE ROW LEVEL SECURITY on workspaces.member -> this test failed (saw 6 members of every workspace)
  // SAFETY: mutation check: replaced policy member_tenant_isolation with USING (true) -> this test failed (saw 6)
  // SAFETY: mutation check: dropped policy member_tenant_isolation -> this scenario failed (default deny refused the W1 inserts)
  it('a query with no WHERE clause in the W1 transaction returns exactly the 3 members of W1', async () => {
    const rows = await withWorkspace(app, w1, (tx) =>
      tx.execute<{ user_id: string; workspace_id: string }>(sql`select user_id, workspace_id from workspaces.member`),
    );
    expect(rows).toHaveLength(3);
    expect(new Set(rows.map((r) => r.workspace_id))).toEqual(new Set([w1]));
    expect(await workspaces.listMembers(w2)).toHaveLength(2);
  });

  // SAFETY: mutation check: replaced the policy with one using current_setting('app.workspace_id', true)::uuid (no nullif) -> this test failed (invalid input syntax for type uuid: "")
  it('the same query with no app.workspace_id set returns no rows, on a connection that already ran a workspace transaction', async () => {
    expect([...(await app.execute(sql`select * from workspaces.member`))]).toEqual([]);
    expect([...(await app.execute(sql`select * from workspaces.workspace`))]).toEqual([]);
  });

  // SAFETY: mutation check: replaced policy workspace_tenant_isolation with USING (true) -> this test failed (saw 3 workspaces)
  it('only the scoped workspace itself is visible in workspaces.workspace', async () => {
    const rows = await withWorkspace(app, w1, (tx) =>
      tx.execute<{ id: string }>(sql`select id from workspaces.workspace`),
    );
    expect([...rows]).toEqual([{ id: w1 }]);
  });

  // SAFETY: mutation check: ALTER POLICY member_tenant_isolation ... WITH CHECK (true) -> this test failed (the insert succeeded)
  it("a write of a member into another workspace is refused by the policy's WITH CHECK", async () => {
    await expect(
      withWorkspace(app, w1, (tx) =>
        tx.execute(
          sql`insert into workspaces.member (workspace_id, user_id, role, status) values (${w2}, ${user(99)}, 'admin', 'active')`,
        ),
      ),
    ).rejects.toThrow(expect.objectContaining({ cause: expect.objectContaining({ code: '42501' }) }));
  });

  it('getMembership does not find a W2 member in W1', async () => {
    expect(await workspaces.getMembership(user(21), w1)).toBeNull();
  });
});

describe('getMembership returns active memberships only', () => {
  // SAFETY: mutation check: returned findMember's row without the status check -> this test failed (got the removed and invited rows)
  it('a removed or invited member gets null', async () => {
    const { id } = await newWorkspace('Statuses');
    await addMember(id, user(71), 'recruiter', 'removed');
    await addMember(id, user(72), 'admin', 'invited');
    expect(await workspaces.getMembership(user(71), id)).toBeNull();
    expect(await workspaces.getMembership(user(72), id)).toBeNull();
    expect(await workspaces.getMembership(ALEX, id)).not.toBeNull();
  });
});

describe('Scenario: The application role cannot switch RLS off', () => {
  // SAFETY: mutation check: ran ALTER TABLE workspaces.member OWNER TO aivera_app -> this test failed (the ALTER succeeded)
  it.each(['member', 'workspace'])(
    'aivera_app running DISABLE ROW LEVEL SECURITY on %s gets a permission error',
    async (table) => {
      await expect(
        app.execute(
          sql`alter table ${sql.identifier('workspaces')}.${sql.identifier(table)} disable row level security`,
        ),
      ).rejects.toThrow(expect.objectContaining({ cause: expect.objectContaining({ code: '42501' }) }));
    },
  );
});

describe('Scenario: The last admin cannot be removed', () => {
  // SAFETY: mutation check: removed the last-admin check in assertCanChangeRole -> this test failed (the change was applied)
  it('the only admin changing their own role to recruiter is refused and nothing changes', async () => {
    const { id } = await newWorkspace('One admin');
    await addMember(id, user(31), 'recruiter');
    await expect(
      workspaces.changeRole({ workspaceId: id, actorUserId: ALEX, targetUserId: ALEX, role: 'recruiter' }),
    ).rejects.toThrow(new WorkspaceError('last_admin'));
    await expect(
      workspaces.changeRole({ workspaceId: id, actorUserId: ALEX, targetUserId: ALEX, role: 'recruiter' }),
    ).rejects.toThrow('A workspace needs at least one admin');
    expect((await workspaces.getMembership(ALEX, id))?.role).toBe('admin');
  });
});

const lockWaits = async () =>
  Number(
    (
      await admin.execute<{ n: string }>(
        sql`select count(*) as n from pg_stat_activity where usename = 'aivera_app' and wait_event_type = 'Lock'`,
      )
    )[0]?.n,
  );

describe('The last-admin rule holds under concurrency', () => {
  let other: Db;
  afterAll(() => other?.$client.end());

  // SAFETY: mutation check: removed .for('update') from lockMembers -> this test failed (both demotions applied, no admin left)
  it('while one admin demotes themselves uncommitted, the other admin stepping down waits and is then refused', async () => {
    const { id } = await newWorkspace('Two admins');
    const sam = user(61);
    await addMember(id, sam, 'admin');
    other = createDb(urlFor('aivera_app'), { max: 1 });

    let change: Promise<void> | undefined;
    await withWorkspace(other, id, async (tx) => {
      // What a concurrent changeRole does: lock every member row, then demote Alex, not yet committed.
      await tx.execute(
        sql`select user_id from workspaces.member where workspace_id = ${id} order by user_id for update`,
      );
      await tx.execute(
        sql`update workspaces.member set role = 'recruiter' where workspace_id = ${id} and user_id = ${ALEX}`,
      );
      change = workspaces.changeRole({ workspaceId: id, actorUserId: sam, targetUserId: sam, role: 'recruiter' });
      change.catch(() => {}); // awaited below; avoids an unhandled rejection while this transaction is open
      for (let i = 0; (await lockWaits()) === 0; i++) {
        if (i > 200) throw new Error('changeRole never waited on the lock');
        await sleep(25);
      }
    });

    await expect(change).rejects.toThrow(new WorkspaceError('last_admin'));
    expect((await workspaces.getMembership(sam, id))?.role).toBe('admin');
  });
});

describe('Scenario Outline: Only admins change roles', () => {
  let id: string;
  const actors: Record<Role, string> = {
    admin: ALEX,
    recruiter: user(41),
    hiring_owner: user(42),
    interviewer: user(43),
  };

  beforeAll(async () => {
    id = (await newWorkspace('Roles')).id;
    for (const role of ['recruiter', 'hiring_owner', 'interviewer'] as const) await addMember(id, actors[role], role);
  });

  // Each row gets its own target so the admin row's change cannot affect the others.
  // SAFETY: mutation check: removed the actor-is-admin check in assertCanChangeRole -> the three 403 rows failed (the change was applied)
  it.each<[Role, 'changed' | '403', number]>([
    ['admin', 'changed', 51],
    ['recruiter', '403', 52],
    ['hiring_owner', '403', 53],
    ['interviewer', '403', 54],
  ])("a %s changing another member's role: %s", async (role, result, targetNumber) => {
    const target = user(targetNumber);
    await addMember(id, target, 'interviewer');
    const change = workspaces.changeRole({
      workspaceId: id,
      actorUserId: actors[role],
      targetUserId: target,
      role: 'recruiter',
    });
    if (result === 'changed') await change;
    else await expect(change).rejects.toThrow(expect.objectContaining({ code: 'forbidden' }));
    expect((await workspaces.getMembership(target, id))?.role).toBe(result === 'changed' ? 'recruiter' : 'interviewer');
  });
});
