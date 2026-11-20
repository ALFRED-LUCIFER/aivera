import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { AuditContract } from '@aivera/audit';
import { createDb, withWorkspace, type Db } from '@aivera/db';
import {
  DEFAULT_SETTINGS,
  ForbiddenError,
  SettingsError,
  WorkspaceError,
  WorkspacePausedError,
  type Client,
  type MemberStatus,
  type Role,
  type WorkspaceContext,
  type WorkspacesContract,
} from '@aivera/workspaces';
import { createAudit } from '@aivera/audit/composition';
import { createNotifications } from '@aivera/notifications/composition';
import { createWorkspaces } from '@aivera/workspaces/composition';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// AIV-P0-008 and AIV-P0-010 acceptance scenarios against real PostgreSQL, connected as the non-owner aivera_app role
// (ADR-004, ADR-005).

const rolesSql = readFileSync(createRequire(import.meta.url).resolve('@aivera/db/sql/roles.sql'), 'utf8');
const dbCli = join(import.meta.dirname, '..', '..', '..', 'packages', 'db', 'src', 'cli.ts');

// Synthetic user ids (opaque ids from the identity module).
const ALEX = '0190d4a2-0000-7000-8000-00000000a1e1';
const user = (n: number) => `0190d4a2-0000-7000-8000-${String(n).padStart(12, '0')}`;

let container: StartedPostgreSqlContainer;
let admin: Db;
let app: Db;
let workspaces: WorkspacesContract;
let audit: AuditContract;

const urlFor = (role: string) =>
  `postgres://${role}:local_dev_only@${container.getHost()}:${container.getPort()}/${container.getDatabase()}`;

/** `pnpm db:migrate`: the same CLI the root script runs, against the test container. */
const dbMigrate = () =>
  execFileSync(process.execPath, [dbCli, 'migrate'], {
    env: { ...process.env, DATABASE_MIGRATOR_URL: urlFor('aivera_migrator') },
  });

const newWorkspace = (name: string, creatorUserId = ALEX) =>
  workspaces.createWorkspace({
    name,
    company: name,
    hiringFocus: 'AI and LLM engineering',
    synthetic: true,
    creatorUserId,
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
  audit = createAudit(app);
  workspaces = createWorkspaces(app, audit);
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
    expect(await applied()).toBe(16);
    dbMigrate();
    expect(await applied()).toBe(16);
  });

  it('the tables are owned by aivera_migrator; the workspace-owned ones have row-level security enabled and forced', async () => {
    const tables = await admin.execute<{ name: string; owner: string; rls: boolean; forced: boolean }>(sql`
      select t.tablename as name, t.tableowner as owner, c.relrowsecurity as rls, c.relforcerowsecurity as forced
      from pg_tables t join pg_class c on c.oid = format('%I.%I', t.schemaname, t.tablename)::regclass
      where t.schemaname = 'workspaces' order by name`);
    expect([...tables]).toEqual([
      // Keyed on the user, not workspace-owned (AIV-P0-010): read before any workspace is open.
      { name: 'active_workspace', owner: 'aivera_migrator', rls: false, forced: false },
      { name: 'ai_token_usage', owner: 'aivera_migrator', rls: true, forced: true },
      { name: 'client', owner: 'aivera_migrator', rls: true, forced: true },
      // The operator console's list (AIV-P2-036, ADR-012): workspace id and created date only, no tenant data.
      { name: 'directory', owner: 'aivera_migrator', rls: false, forced: false },
      { name: 'invitation', owner: 'aivera_migrator', rls: true, forced: true },
      { name: 'job_grant', owner: 'aivera_migrator', rls: true, forced: true },
      { name: 'member', owner: 'aivera_migrator', rls: true, forced: true },
      { name: 'settings', owner: 'aivera_migrator', rls: true, forced: true },
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
      title: null,
    });
    expect(await workspaces.activeWorkspace(ALEX)).toBe(created.id);
  });

  // AIV-P1-001: "the audit log records 'workspace created' with my name and the time".
  // SAFETY: mutation check: removed store.audit from createWorkspace -> this test failed (no entry)
  it('records "workspace created" by the creator, with the time', async () => {
    const created = await newWorkspace('Audited Hiring Co');
    const entries = await audit.listFor(created.id, { type: 'workspace', id: created.id });
    expect(entries).toEqual([
      expect.objectContaining({ action: 'workspace.created', actor: { type: 'user', id: ALEX } }),
    ]);
    expect(entries[0]?.occurredAt).toBeInstanceOf(Date);
  });

  // SAFETY: mutation check: wrote the audit entry in a second inWorkspace transaction -> this test failed (workspace row left)
  it('a failing step leaves no workspace, member or active-workspace row', async () => {
    const failing = createWorkspaces(app, { ...audit, record: () => Promise.reject(new Error('audit down')) });
    const creator = user(99);
    await expect(
      failing.createWorkspace({ name: 'Rolled Back Co', company: '', hiringFocus: 'sales', creatorUserId: creator }),
    ).rejects.toThrow('audit down');
    const left = await admin.execute<{ n: string }>(sql`
      select (select count(*) from workspaces.workspace where name = 'Rolled Back Co')
        + (select count(*) from workspaces.member where user_id = ${creator})
        + (select count(*) from workspaces.active_workspace where user_id = ${creator}) as n`);
    expect(Number(left[0]?.n)).toBe(0);
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
    ).rejects.toThrow(expect.objectContaining({ code: '42501' }));
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
  it.each(['member', 'workspace', 'client', 'job_grant', 'ai_token_usage', 'settings'])(
    'aivera_app running DISABLE ROW LEVEL SECURITY on %s gets a permission error',
    async (table) => {
      await expect(
        app.execute(
          sql`alter table ${sql.identifier('workspaces')}.${sql.identifier(table)} disable row level security`,
        ),
      ).rejects.toThrow(expect.objectContaining({ code: '42501' }));
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
    // AIV-P0-013: a role change is audited in its transaction; a refused one leaves no entry.
    // SAFETY: mutation check: removed store.audit from changeRole -> the admin row failed (no entry)
    const entries = await audit.listFor(id, { type: 'member', id: target });
    expect(entries).toEqual(
      result === 'changed'
        ? [
            expect.objectContaining({
              action: 'member.role_changed',
              actor: { type: 'user', id: ALEX },
              before: { role: 'interviewer' },
              after: { role: 'recruiter' },
            }),
          ]
        : [],
    );
  });
});

// AIV-P0-010: the request context. Jobs do not exist yet (AIV-P1-005), so "lists jobs" lists the workspace's members.
const currentSetting = async (tx: Parameters<Parameters<typeof withWorkspace>[2]>[0]) =>
  (await tx.execute<{ id: string }>(sql`select current_setting('app.workspace_id') as id`))[0]?.id;

describe("Scenario: Requests run in the user's active workspace", () => {
  it('an active recruiter of W1 runs with app.workspace_id = W1 and sees only W1 rows', async () => {
    const w1 = (await newWorkspace('Context W1')).id;
    await newWorkspace('Context W2');
    await addMember(w1, user(41), 'recruiter');
    const seen = await workspaces.withWorkspace({ userId: user(41) }, w1, async ({ tx, role }) => {
      const rows = await tx.execute<{ workspace_id: string }>(sql`select workspace_id from workspaces.member`);
      return { role, setting: await currentSetting(tx), workspaces: new Set(rows.map((r) => r.workspace_id)) };
    });
    expect(seen).toEqual({ role: 'recruiter', setting: w1, workspaces: new Set([w1]) });
  });
});

describe('Scenario: A forged workspace id is refused', () => {
  // SAFETY: mutation check: skipped the membership check in withWorkspace (context.ts) -> this test failed (the handler ran)
  it('a member of W1 only, sending W2, gets ForbiddenError and the handler never runs', async () => {
    const w1 = (await newWorkspace('Forged W1')).id;
    const w2 = (await newWorkspace('Forged W2')).id;
    await addMember(w1, user(51), 'recruiter');
    const handler = vi.fn(async () => 'ran');
    await expect(workspaces.withWorkspace({ userId: user(51) }, w2, handler)).rejects.toBeInstanceOf(ForbiddenError);
    expect(handler).not.toHaveBeenCalled();
  });
});

describe('Scenario: Switching workspace re-checks membership', () => {
  // SAFETY: mutation check: removed the membership check in switchWorkspace -> this test failed (the active workspace became Gulf Talent Partners)
  it('"Nadia Freelance" switches to "Gulf Talent Partners", and a refused switch keeps "Nadia Freelance"', async () => {
    const nadia = { userId: user(61) };
    const own = (await newWorkspace('Nadia Freelance', nadia.userId)).id;
    const gulf = (await newWorkspace('Gulf Talent Partners')).id;
    await addMember(gulf, nadia.userId, 'recruiter');
    expect(await workspaces.activeWorkspace(nadia.userId)).toBe(own); // the creator lands in a new workspace

    await workspaces.switchWorkspace(nadia, gulf);
    const active = await workspaces.activeWorkspace(nadia.userId);
    expect(active).toBe(gulf);
    expect(await workspaces.withWorkspace(nadia, active ?? '', ({ tx }) => currentSetting(tx))).toBe(gulf);

    await workspaces.switchWorkspace(nadia, own);
    await withWorkspace(app, gulf, (tx) =>
      tx.execute(sql`update workspaces.member set status = 'removed' where user_id = ${nadia.userId}`),
    );
    await expect(workspaces.switchWorkspace(nadia, gulf)).rejects.toBeInstanceOf(ForbiddenError);
    expect(await workspaces.activeWorkspace(nadia.userId)).toBe(own);
  });

  it('a user who never chose a workspace has none', async () => {
    expect(await workspaces.activeWorkspace(user(62))).toBeNull();
  });
});

// Scenario: Worker jobs carry their workspace (AIV-P0-010) moved with the consumer wrapper to worker.test.ts (AIV-P0-015).

// AIV-P0-906: workspace type, agency clients and job grants. Jobs do not exist yet (AIV-P1-005), so jobs are synthetic
// ids and `viewCandidate` stands in for a server action wrapped by workspaceAction('candidate.view', ..., { resource }):
// the same withWorkspace -> resource -> authorize -> handler sequence (apps/web/src/server/workspace.test.ts proves the
// wrapper runs it in that order).
const job = (n: number) => `0190d4a2-0000-7000-9000-${String(n).padStart(12, '0')}`;
const as = <T>(userId: string, workspaceId: string, fn: (ctx: WorkspaceContext) => Promise<T>) =>
  workspaces.withWorkspace({ userId }, workspaceId, fn);

const settings = (tx: WorkspaceContext['tx']) =>
  tx
    .execute<{ scope: string; jobs: string; clients: string }>(
      sql`select current_setting('app.job_scope') as scope, current_setting('app.job_ids') as jobs,
        current_setting('app.client_ids') as clients`,
    )
    .then((rows) => rows[0]);

describe('AIV-P0-906: workspace type, agency clients and job-scoped access', () => {
  const FAISAL = user(9061);
  const LINA = user(9062);
  const OMAR = user(9063);
  const RANA = user(9064); // a second recruiter, for the refused grant
  const [J1, J2, J3, J4] = [1, 2, 3, 4].map(job) as [string, string, string, string];
  let gulf: string;
  let dune: Client;
  let falcon: Client;
  const clientOf = new Map<string, string>(); // job id -> client id, as jobs.job will hold it (AIV-P1-005)
  const handler = vi.fn(async (_ctx: WorkspaceContext, input: { jobId: string }) => `read ${input.jobId}`);
  const viewCandidate = (userId: string, jobId: string) =>
    as(userId, gulf, async (ctx) => {
      // The resource comes from the stored record (here: the job's client), never from the request.
      await workspaces.authorize(ctx, 'candidate.view', { jobId, clientId: clientOf.get(jobId) ?? null });
      return handler(ctx, { jobId });
    });
  const outcome = (userId: string, jobId: string) =>
    viewCandidate(userId, jobId).then(
      () => 'allowed',
      (error: unknown) => (error instanceof ForbiddenError ? '403' : `threw ${String(error)}`),
    );

  beforeAll(async () => {
    gulf = (await newWorkspace('Gulf Talent Partners')).id;
    await addMember(gulf, FAISAL, 'hiring_owner');
    await addMember(gulf, LINA, 'interviewer');
    await addMember(gulf, OMAR, 'recruiter');
    await addMember(gulf, RANA, 'recruiter');
    await as(ALEX, gulf, (ctx) => workspaces.setWorkspaceType(ctx, 'agency'));
    falcon = await as(ALEX, gulf, (ctx) => workspaces.addClient(ctx, 'Falcon Pay'));
    dune = await as(OMAR, gulf, (ctx) => workspaces.addClient(ctx, 'Dune Logistics'));
    clientOf.set(J1, dune.id).set(J2, falcon.id).set(J4, dune.id);
    await as(ALEX, gulf, (ctx) => workspaces.grantJobAccess(ctx, { userId: FAISAL, clientId: dune.id }));
    await as(ALEX, gulf, (ctx) => workspaces.grantJobAccess(ctx, { userId: LINA, jobId: J1 }));
  });

  describe('Scenario: A workspace is in-house unless set to agency', () => {
    it('"Demo Hiring Co" is an in-house team and adding a client to it is refused', async () => {
      const { id } = await newWorkspace('Demo Hiring Co');
      expect((await as(ALEX, id, (ctx) => workspaces.getWorkspace(ctx)))?.type).toBe('in_house');
      await expect(as(ALEX, id, (ctx) => workspaces.addClient(ctx, 'Falcon Pay'))).rejects.toThrow(
        new WorkspaceError('not_agency'),
      );
      await expect(as(ALEX, id, (ctx) => workspaces.addClient(ctx, 'Falcon Pay'))).rejects.toThrow(
        'Only agency workspaces have clients.',
      );
    });

    it('an agency with clients cannot become in-house; the type change is audited', async () => {
      await expect(as(ALEX, gulf, (ctx) => workspaces.setWorkspaceType(ctx, 'in_house'))).rejects.toThrow(
        new WorkspaceError('has_clients'),
      );
      expect((await as(ALEX, gulf, (ctx) => workspaces.getWorkspace(ctx)))?.type).toBe('agency');
      expect(await audit.listFor(gulf, { type: 'workspace', id: gulf })).toContainEqual(
        expect.objectContaining({
          action: 'workspace.type_changed',
          actor: { type: 'user', id: ALEX },
          before: { type: 'in_house' },
          after: { type: 'agency' },
        }),
      );
    });

    it('only an admin sets the type', async () => {
      await expect(as(OMAR, gulf, (ctx) => workspaces.setWorkspaceType(ctx, 'in_house'))).rejects.toBeInstanceOf(
        ForbiddenError,
      );
    });
  });

  describe('Scenario: An agency adds clients', () => {
    it('both clients are listed, and "falcon pay" again is refused', async () => {
      const names = (await as(ALEX, gulf, (ctx) => workspaces.listClients(ctx))).map((c) => c.name);
      expect(names).toEqual(['Dune Logistics', 'Falcon Pay']);
      await expect(as(ALEX, gulf, (ctx) => workspaces.addClient(ctx, 'falcon pay'))).rejects.toThrow(
        'A client with this name already exists.',
      );
      await expect(as(ALEX, gulf, (ctx) => workspaces.renameClient(ctx, dune.id, ' FALCON PAY '))).rejects.toThrow(
        new WorkspaceError('client_exists'),
      );
      expect(await audit.listFor(gulf, { type: 'client', id: dune.id })).toEqual([
        expect.objectContaining({ action: 'client.added', actor: { type: 'user', id: OMAR } }),
      ]);
    });

    it('renaming and archiving are audited; hiring owners and interviewers cannot manage clients', async () => {
      const temp = await as(ALEX, gulf, (ctx) => workspaces.addClient(ctx, 'Oasis Retail'));
      await as(OMAR, gulf, (ctx) => workspaces.renameClient(ctx, temp.id, 'Oasis Retail Group'));
      await as(ALEX, gulf, (ctx) => workspaces.archiveClient(ctx, temp.id));
      const stored = (await as(ALEX, gulf, (ctx) => workspaces.listClients(ctx))).find((c) => c.id === temp.id);
      expect(stored).toMatchObject({ name: 'Oasis Retail Group', archivedAt: expect.any(Date) });
      expect((await audit.listFor(gulf, { type: 'client', id: temp.id })).map((e) => e.action)).toEqual([
        'client.added',
        'client.renamed',
        'client.archived',
      ]);
      // SAFETY: mutation check: dropped the archivedAt check in grantJobAccess -> this test failed (the grant was stored)
      await expect(
        as(ALEX, gulf, (ctx) => workspaces.grantJobAccess(ctx, { userId: LINA, clientId: temp.id })),
      ).rejects.toThrow(new WorkspaceError('client_not_found'));
      for (const userId of [FAISAL, LINA])
        await expect(as(userId, gulf, (ctx) => workspaces.addClient(ctx, 'Mirage Labs'))).rejects.toBeInstanceOf(
          ForbiddenError,
        );
    });
  });

  describe("Scenario: A hiring owner cannot read another client's job or candidates", () => {
    // SAFETY: mutation check: grantsCover ignored the client (`g.jobId === jobId` only) -> this test failed (J1 was 403)
    // SAFETY: mutation check: grantsCover matched any client grant (`g.clientId != null`) -> this test failed (J2 was allowed)
    it("Faisal, granted all of Dune Logistics' jobs, gets 403 on J2 (Falcon Pay) and no read; J1 is allowed", async () => {
      handler.mockClear();
      expect(await outcome(FAISAL, J2)).toBe('403');
      expect(handler).not.toHaveBeenCalled();
      expect(await outcome(FAISAL, J1)).toBe('allowed');
      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  describe("Scenario: A client grant covers that client's new jobs", () => {
    it('a new job J3 for Dune Logistics opens for Faisal without a new grant', async () => {
      clientOf.set(J3, dune.id);
      expect(await outcome(FAISAL, J3)).toBe('allowed');
    });
  });

  describe('Scenario: An interviewer granted one job sees only that job', () => {
    it('Lina, granted J1 only, gets 403 on J4 of the same client', async () => {
      expect(await outcome(LINA, J1)).toBe('allowed');
      expect(await outcome(LINA, J4)).toBe('403');
    });
  });

  describe('Scenario: Admins and recruiters are not job-scoped', () => {
    it('Omar, a recruiter with no grants, opens J1 and J2', async () => {
      expect([await outcome(OMAR, J1), await outcome(OMAR, J2)]).toEqual(['allowed', 'allowed']);
    });
  });

  describe('Scenario: Grants are only for hiring owners and interviewers', () => {
    // SAFETY: mutation check: removed the JOB_SCOPED_ROLES check in grantJobAccess -> this test failed (the grant was stored)
    it('granting J1 to a recruiter is refused and stores nothing', async () => {
      await expect(
        as(ALEX, gulf, (ctx) => workspaces.grantJobAccess(ctx, { userId: RANA, jobId: J1 })),
      ).rejects.toThrow('Only hiring owners and interviewers get job access.');
      const grants = await as(ALEX, gulf, (ctx) => workspaces.listJobGrants(ctx));
      expect(grants.filter((g) => g.userId === RANA)).toEqual([]);
    });

    it('only an admin grants; hiring owners and interviewers cannot list grants', async () => {
      await expect(
        as(OMAR, gulf, (ctx) => workspaces.grantJobAccess(ctx, { userId: LINA, jobId: J2 })),
      ).rejects.toBeInstanceOf(ForbiddenError);
      await expect(as(FAISAL, gulf, (ctx) => workspaces.listJobGrants(ctx))).rejects.toBeInstanceOf(ForbiddenError);
    });
  });

  describe('Scenario: Revoking a grant takes effect on the next request', () => {
    it("Lina's next request to J1 after the revocation is 403, and the audit log records who and when", async () => {
      const panel = user(9065);
      await addMember(gulf, panel, 'interviewer');
      await as(ALEX, gulf, (ctx) => workspaces.grantJobAccess(ctx, { userId: panel, jobId: J1 }));
      // Granting twice changes nothing.
      await as(ALEX, gulf, (ctx) => workspaces.grantJobAccess(ctx, { userId: panel, jobId: J1 }));
      const grants = (await as(ALEX, gulf, (ctx) => workspaces.listJobGrants(ctx))).filter((g) => g.userId === panel);
      expect(grants).toEqual([expect.objectContaining({ jobId: J1, clientId: null, grantedBy: ALEX })]);
      expect(await outcome(panel, J1)).toBe('allowed');

      await as(ALEX, gulf, (ctx) => workspaces.revokeJobAccess(ctx, grants[0]?.id ?? ''));
      expect(await outcome(panel, J1)).toBe('403');
      const entries = await audit.listFor(gulf, { type: 'member', id: panel });
      expect(entries.map((e) => e.action)).toEqual(['job_access.granted', 'job_access.revoked']);
      expect(entries[1]).toMatchObject({
        actor: { type: 'user', id: ALEX },
        before: { grantId: grants[0]?.id, jobId: J1, clientId: null },
        occurredAt: expect.any(Date),
      });
    });
  });

  describe('Changing a role to admin or recruiter deletes the grants', () => {
    it('a hiring owner made recruiter loses their grants, and made hiring owner again starts with none', async () => {
      const huda = user(9066);
      await addMember(gulf, huda, 'hiring_owner');
      await as(ALEX, gulf, (ctx) => workspaces.grantJobAccess(ctx, { userId: huda, clientId: falcon.id }));
      const grantsOf = async () =>
        (await as(ALEX, gulf, (ctx) => workspaces.listJobGrants(ctx))).filter((g) => g.userId === huda);
      expect(await grantsOf()).toHaveLength(1);
      await workspaces.changeRole({ workspaceId: gulf, actorUserId: ALEX, targetUserId: huda, role: 'recruiter' });
      expect(await grantsOf()).toEqual([]);
      // SAFETY: mutation check: removed the job_access.revoked entries from changeRole -> this test failed
      expect((await audit.listFor(gulf, { type: 'member', id: huda })).map((e) => e.action)).toEqual([
        'job_access.granted',
        'job_access.revoked',
        'member.role_changed',
      ]);
      await workspaces.changeRole({ workspaceId: gulf, actorUserId: ALEX, targetUserId: huda, role: 'hiring_owner' });
      expect(await grantsOf()).toEqual([]);
      expect(await outcome(huda, J2)).toBe('403');
    });
  });

  describe('The job-scope settings for row-level security (ADR-005 point 6)', () => {
    // SAFETY: mutation check: set app.job_scope to 'all' for every role in withWorkspace -> this test failed (Lina got 'all')
    it('are set per role from the grants, as uuid arrays', async () => {
      expect(await as(LINA, gulf, ({ tx }) => settings(tx))).toEqual({
        scope: 'granted',
        jobs: `{${J1}}`,
        clients: '{}',
      });
      expect(await as(FAISAL, gulf, ({ tx }) => settings(tx))).toEqual({
        scope: 'granted',
        jobs: '{}',
        clients: `{${dune.id}}`,
      });
      expect(await as(OMAR, gulf, ({ tx }) => settings(tx))).toEqual({ scope: 'all', jobs: '{}', clients: '{}' });
      const [cast] = await as(FAISAL, gulf, ({ tx }) =>
        tx.execute<{ ok: boolean }>(
          sql`select ${dune.id}::uuid = any(nullif(current_setting('app.client_ids', true), '')::uuid[]) as ok`,
        ),
      );
      expect(cast?.ok).toBe(true);
    });

    // SAFETY: mutation check: set_config(..., false) for app.job_scope -> this test failed (the setting outlived the transaction)
    it('are transaction-local: the same pooled connection reads them empty afterwards', async () => {
      await as(LINA, gulf, ({ tx }) => settings(tx));
      const [after] = await app.execute<{ scope: string | null; jobs: string | null }>(
        sql`select current_setting('app.job_scope', true) as scope, current_setting('app.job_ids', true) as jobs`,
      );
      expect([after?.scope ?? '', after?.jobs ?? '']).toEqual(['', '']);
    });
  });

  describe('Scenario: Clients and grants never cross workspaces', () => {
    let w1: string;
    let w2Client: string;

    beforeAll(async () => {
      w1 = (await newWorkspace('Isolation W1')).id;
      await addMember(w1, LINA, 'interviewer');
      await as(ALEX, w1, (ctx) => workspaces.setWorkspaceType(ctx, 'agency'));
      const own = await as(ALEX, w1, (ctx) => workspaces.addClient(ctx, 'Falcon Pay'));
      await as(ALEX, w1, (ctx) => workspaces.grantJobAccess(ctx, { userId: LINA, clientId: own.id }));
      w2Client = falcon.id; // gulf is W2: it has clients and grants
    });

    // SAFETY: mutation check: replaced policy client_tenant_isolation with USING (true) -> this test failed (saw Gulf's clients)
    // SAFETY: mutation check: dropped policy client_tenant_isolation -> this scenario failed (default deny refused the inserts)
    it('a query on workspaces.client with no WHERE clause in W1 returns only W1 rows', async () => {
      const rows = await withWorkspace(app, w1, (tx) =>
        tx.execute<{ workspace_id: string }>(sql`select workspace_id from workspaces.client`),
      );
      expect(rows.map((r) => r.workspace_id)).toEqual([w1]);
    });

    // SAFETY: mutation check: replaced policy job_grant_tenant_isolation with USING (true) -> this test failed (saw Gulf's grants)
    // SAFETY: mutation check: dropped policy job_grant_tenant_isolation -> this scenario failed (default deny refused the inserts)
    it('a query on workspaces.job_grant with no WHERE clause in W1 returns only W1 rows', async () => {
      const rows = await withWorkspace(app, w1, (tx) =>
        tx.execute<{ workspace_id: string }>(sql`select workspace_id from workspaces.job_grant`),
      );
      expect(rows.map((r) => r.workspace_id)).toEqual([w1]);
    });

    it("a W1 grant naming W2's client is refused by the workspace-keyed foreign key", async () => {
      await expect(
        withWorkspace(app, w1, (tx) =>
          tx.execute(sql`insert into workspaces.job_grant (id, workspace_id, user_id, client_id, granted_by)
            values (${user(9067)}, ${w1}, ${LINA}, ${w2Client}, ${ALEX})`),
        ),
      ).rejects.toThrow(expect.objectContaining({ code: '23503' }));
      await expect(
        as(ALEX, w1, (ctx) => workspaces.grantJobAccess(ctx, { userId: LINA, clientId: w2Client })),
      ).rejects.toThrow(new WorkspaceError('client_not_found'));
    });

    it.each([
      ['neither a job nor a client', null, null],
      ['both a job and a client', job(9), 'own'],
    ])('a grant naming %s is refused by the check constraint', async (_label, jobId, clientKind) => {
      const [own] = await as(ALEX, w1, (ctx) => workspaces.listClients(ctx));
      const clientId = clientKind ? (own?.id ?? null) : null;
      await expect(
        withWorkspace(app, w1, (tx) =>
          tx.execute(sql`insert into workspaces.job_grant (id, workspace_id, user_id, job_id, client_id, granted_by)
            values (${user(9068)}, ${w1}, ${LINA}, ${jobId}, ${clientId}, ${ALEX})`),
        ),
      ).rejects.toThrow(expect.objectContaining({ code: '23514', constraint: 'job_grant_target_check' }));
    });
  });
});

const settingsEntries = (workspaceId: string) => audit.listFor(workspaceId, { type: 'workspace', id: workspaceId });

describe('AIV-P1-051: workspace settings with approved defaults', () => {
  const RECRUITER = user(5101);
  const OWNER = user(5102);
  const PANEL = user(5103);
  let w1: string;
  let w2: string;

  beforeAll(async () => {
    w1 = (await newWorkspace('Settings W1')).id;
    w2 = (await newWorkspace('Settings W2')).id;
    await addMember(w1, RECRUITER, 'recruiter');
    await addMember(w1, OWNER, 'hiring_owner');
    await addMember(w1, PANEL, 'interviewer');
  });

  it('Scenario: A new workspace gets every approved default', async () => {
    const { id } = await newWorkspace('Demo Hiring Co');
    expect(await as(ALEX, id, (ctx) => workspaces.getSettings(ctx))).toEqual(DEFAULT_SETTINGS);
    expect(DEFAULT_SETTINGS).toMatchObject({ clientShareLinkDays: 14, sessionIdleHours: 12, pilotPassLinePercent: 70 });
  });

  // SAFETY: mutation check: removed store.audit from updateSettings -> this test failed (no settings entry)
  it('Scenario: An admin changes a setting and it is audited', async () => {
    const saved = await as(ALEX, w1, (ctx) => workspaces.updateSettings(ctx, { clientShareLinkDays: 7 }));
    expect(saved).toEqual({ ...DEFAULT_SETTINGS, clientShareLinkDays: 7 });
    expect(await as(RECRUITER, w1, (ctx) => workspaces.getSettings(ctx))).toEqual(saved);
    const changes = (await settingsEntries(w1)).filter((e) => e.action === 'workspace.settings_changed');
    expect(changes).toHaveLength(1);
    const [entry] = changes;
    expect(entry).toMatchObject({
      actor: { type: 'user', id: ALEX },
      before: { clientShareLinkDays: 14 },
      after: { clientShareLinkDays: 7 },
    });
    expect(entry?.occurredAt).toBeInstanceOf(Date);
  });

  it('a patch that changes nothing writes no audit entry', async () => {
    const before = (await settingsEntries(w1)).length;
    await as(ALEX, w1, (ctx) => workspaces.updateSettings(ctx, { clientShareLinkDays: 7 }));
    expect(await settingsEntries(w1)).toHaveLength(before);
  });

  // SAFETY: mutation check: used the patch without parseSettingsPatch -> every row failed (the value was saved)
  it.each([
    ['clientShareLinkDays', 0, 1, 30],
    ['sessionIdleHours', 24, 1, 12],
    ['evidenceFollowUpMax', 5, 0, 3],
    ['pilotPassLinePercent', 40, 50, 95],
  ] as const)('Scenario Outline: %s = %i is refused, nothing saved or audited', async (key, value, min, max) => {
    const [stored, entries] = [await as(ALEX, w1, (ctx) => workspaces.getSettings(ctx)), await settingsEntries(w1)];
    await expect(as(ALEX, w1, (ctx) => workspaces.updateSettings(ctx, { [key]: value }))).rejects.toThrow(
      new SettingsError(`${key} must be between ${min} and ${max}`),
    );
    expect(await as(ALEX, w1, (ctx) => workspaces.getSettings(ctx))).toEqual(stored);
    expect(await settingsEntries(w1)).toHaveLength(entries.length);
  });

  // SAFETY: mutation check: removed authorize from updateSettings -> the recruiter, hiring_owner and interviewer rows failed (changed)
  it.each([
    ['admin', 'changed', ALEX],
    ['recruiter', '403', RECRUITER],
    ['hiring_owner', '403', OWNER],
    ['interviewer', '403', PANEL],
  ])('Scenario Outline: a member with role %s updating a setting gets "%s"', async (_role, expected, userId) => {
    const result = await as(userId, w1, (ctx) => workspaces.updateSettings(ctx, { invitationDays: 10 })).then(
      () => 'changed',
      (error: unknown) => (error instanceof ForbiddenError ? '403' : String(error)),
    );
    expect(result).toBe(expected);
  });

  // SAFETY: mutation check: dropped policy settings_tenant_isolation -> this test failed (default deny refused the W1 write)
  // SAFETY: mutation check: replaced policy settings_tenant_isolation with USING (true) -> this test failed (saw both rows)
  it("Scenario: Another workspace's settings are invisible at the database", async () => {
    await as(ALEX, w2, (ctx) => workspaces.updateSettings(ctx, { mergeUndoDays: 60 }));
    const rows = await withWorkspace(app, w1, (tx) =>
      tx.execute<{ workspace_id: string }>(sql`select workspace_id from workspaces.settings`),
    );
    expect(rows.map((r) => r.workspace_id)).toEqual([w1]);
    expect([...(await app.execute(sql`select * from workspaces.settings`))]).toEqual([]);
  });

  // The rule that issued links keep their expiry is tested where links are issued (AIV-P2-013): here, a read returns
  // the value in force at the time of the call, and nothing is cached.
  it('Scenario: A change applies going forward only (getSettings reads at call time)', async () => {
    const { id } = await newWorkspace('Forward Only Co');
    const issuedWith = await as(ALEX, id, (ctx) => workspaces.getSettings(ctx));
    await as(ALEX, id, (ctx) => workspaces.updateSettings(ctx, { clientShareLinkDays: 7 }));
    expect(issuedWith.clientShareLinkDays).toBe(14);
    expect((await as(ALEX, id, (ctx) => workspaces.getSettings(ctx))).clientShareLinkDays).toBe(7);
  });
});

describe('AIV-P1-003: invitations to the workspace and to its jobs', () => {
  const OMAR = user(1031); // admin of the agency
  const NADIA = user(1032);
  const FAISAL = user(1033);
  const LINA = user(1034);
  const RANA = user(1035); // a recruiter of the agency
  const HUDA = user(1036);
  const [STAFF_BACKEND, PM_PAYMENTS] = [job(1031), job(1032)] as [string, string];
  let gulf: string;
  let dune: Client;
  let falcon: Client;
  const asOmar = <T>(fn: (ctx: WorkspaceContext) => Promise<T>) => as(OMAR, gulf, fn);
  const invite = (email: string, role: Role, access: { jobIds?: string[]; clientIds?: string[] } = {}) =>
    asOmar((ctx) => workspaces.inviteMember(ctx, { email, role, title: null, jobIds: [], clientIds: [], ...access }));
  const openJob = (userId: string, jobId: string, clientId: string) =>
    as(userId, gulf, (ctx) => workspaces.authorize(ctx, 'job.view', { jobId, clientId })).then(
      () => 'allowed',
      (error: unknown) => (error instanceof ForbiddenError ? '403' : `threw ${String(error)}`),
    );
  const listed = () => asOmar((ctx) => workspaces.listInvitations(ctx));
  const tryAccept = (token: string) => workspaces.acceptInvitation({ userId: HUDA, email: 'huda@example.com' }, token);
  const rawInvitationInsert = (role: Role, jobIds: ReturnType<typeof sql>) =>
    withWorkspace(app, gulf, (tx) =>
      tx.execute(sql`insert into workspaces.invitation (id, workspace_id, email, role, job_ids, token_hash, invited_by, expires_at)
        values (gen_random_uuid(), ${gulf}, 'huda@example.com', ${role}, ${jobIds}, gen_random_uuid()::text, ${OMAR}, now())`),
    );

  beforeAll(async () => {
    gulf = (await newWorkspace('Gulf Talent Partners', OMAR)).id;
    await addMember(gulf, RANA, 'recruiter');
    await asOmar((ctx) => workspaces.setWorkspaceType(ctx, 'agency'));
    falcon = await asOmar((ctx) => workspaces.addClient(ctx, 'Falcon Pay'));
    dune = await asOmar((ctx) => workspaces.addClient(ctx, 'Dune Logistics'));
  });

  describe("Scenario: Invite a client's hiring owner to that client's jobs", () => {
    it('stores an invitation that expires in 7 days, listed with its role and client', async () => {
      const before = Date.now();
      const { invitation } = await asOmar((ctx) =>
        workspaces.inviteMember(ctx, {
          email: 'faisal@example.com',
          role: 'hiring_owner',
          title: 'Head of Engineering, Dune Logistics',
          jobIds: [],
          clientIds: [dune.id],
        }),
      );
      const days = (invitation.expiresAt.getTime() - before) / 86_400_000;
      expect(days).toBeGreaterThan(6.99);
      expect(days).toBeLessThan(7.01);
      expect(await listed()).toContainEqual(
        expect.objectContaining({ email: 'faisal@example.com', role: 'hiring_owner', clientIds: [dune.id] }),
      );
    });

    // SAFETY: mutation check: swallowed the error from alongside in inviteMember -> this test failed (the invitation was kept)
    it('queues its invitation email in the same transaction; a failed queue stores no invitation', async () => {
      const notifications = createNotifications({
        encryptionKey: randomBytes(32).toString('base64'),
        origin: 'https://aivera.example',
        synthetic: true,
      });
      const sender = { name: 'Omar Agency', shortName: 'Omar', email: 'omar.agency@example.com', workspace: 'Gulf' };
      const input = {
        email: 'faisal@example.com',
        role: 'hiring_owner',
        title: null,
        jobIds: [],
        clientIds: [dune.id],
      };
      const { invitation } = await asOmar((ctx) =>
        workspaces.inviteMember(ctx, { ...input, role: 'hiring_owner' }, async (sent, token) => {
          await notifications.queueEmail(ctx, {
            template: 'member-invitation',
            to: sent.email,
            causedBy: sent.id,
            sender,
            data: {
              role: sent.role,
              scope: "all of Dune Logistics' jobs",
              expiresAt: sent.expiresAt,
              link: `https://aivera.example/invite?token=${encodeURIComponent(token)}`,
            },
          });
        }),
      );
      const queued = await withWorkspace(app, gulf, (tx) =>
        tx.execute(sql`select template from notifications.message where caused_by = ${invitation.id}`),
      );
      expect([...queued]).toEqual([{ template: 'member-invitation' }]);

      const count = (await listed()).length;
      await expect(
        asOmar((ctx) =>
          workspaces.inviteMember(ctx, { ...input, role: 'hiring_owner' }, async () => {
            throw new Error('email refused');
          }),
        ),
      ).rejects.toThrow('email refused');
      expect(await listed()).toHaveLength(count);
    });

    // SAFETY: mutation check: stored the token itself as token_hash -> this test failed (the token was in the row)
    it('keeps only the hash of the link token', async () => {
      const { invitation, token } = await invite('huda@example.com', 'hiring_owner', { clientIds: [falcon.id] });
      const [row] = await withWorkspace(app, gulf, (tx) =>
        tx.execute<Record<string, unknown>>(sql`select * from workspaces.invitation where id = ${invitation.id}`),
      );
      expect(JSON.stringify(row)).not.toContain(token.split('.')[1]);
      await asOmar((ctx) => workspaces.revokeInvitation(ctx, invitation.id));
    });
  });

  it('Scenario: Invite an interviewer to one job: the invitation names only that job', async () => {
    const { invitation } = await invite('lina@example.com', 'interviewer', { jobIds: [STAFF_BACKEND] });
    expect(invitation).toMatchObject({ jobIds: [STAFF_BACKEND], clientIds: [] });
  });

  describe('Scenario: A hiring owner or interviewer needs at least one job', () => {
    // SAFETY: mutation check: removed the jobs_required throw in assertAccessFitsRole -> this test failed (the database refused it instead)
    it('is refused with "Choose the jobs this person works on." and no invitation is created', async () => {
      const count = (await listed()).length;
      await expect(invite('huda@example.com', 'hiring_owner')).rejects.toThrow(new WorkspaceError('jobs_required'));
      expect(await listed()).toHaveLength(count);
    });

    // SAFETY: mutation check: dropped constraint invitation_access_check -> this test failed (both inserts succeeded)
    it('the check constraint refuses a hiring owner invitation without jobs, and a recruiter one with jobs', async () => {
      await expect(rawInvitationInsert('hiring_owner', sql`'{}'::uuid[]`)).rejects.toThrow(
        expect.objectContaining({ code: '23514', constraint: 'invitation_access_check' }),
      );
      await expect(rawInvitationInsert('recruiter', sql`array[${STAFF_BACKEND}]::uuid[]`)).rejects.toThrow(
        expect.objectContaining({ code: '23514', constraint: 'invitation_access_check' }),
      );
    });
  });

  describe('Scenario: Accepting joins the workspace with the invited role and jobs', () => {
    let token: string;
    let invitationId: string;

    beforeAll(async () => {
      const sent = await invite('faisal@example.com', 'hiring_owner', { clientIds: [dune.id] });
      token = sent.token;
      invitationId = sent.invitation.id;
    });

    it('a different signed-in email is refused and nothing changes', async () => {
      await expect(workspaces.acceptInvitation({ userId: HUDA, email: 'huda@example.com' }, token)).rejects.toThrow(
        new WorkspaceError('invitation_email'),
      );
      expect(await workspaces.getMembership(HUDA, gulf)).toBeNull();
    });

    // SAFETY: mutation check: removed insertGrant from acceptInvitation -> this test failed (Staff Backend Engineer was 403)
    // SAFETY: mutation check: removed store.audit from acceptInvitation -> this test failed (no acceptance entry)
    it("makes them a hiring owner who opens Dune's job and gets 403 on Falcon Pay's, with the acceptance audited", async () => {
      await workspaces.acceptInvitation({ userId: FAISAL, email: 'Faisal@Example.com' }, token);
      expect(await workspaces.getMembership(FAISAL, gulf)).toMatchObject({ role: 'hiring_owner', status: 'active' });
      expect(await workspaces.activeWorkspace(FAISAL)).toBe(gulf);
      expect(await openJob(FAISAL, STAFF_BACKEND, dune.id)).toBe('allowed');
      expect(await openJob(FAISAL, PM_PAYMENTS, falcon.id)).toBe('403');
      expect(await audit.listFor(gulf, { type: 'invitation', id: invitationId })).toContainEqual(
        expect.objectContaining({ action: 'invitation.accepted', actor: { type: 'user', id: FAISAL } }),
      );
    });

    // One transaction: PostgreSQL aborts it at the failed grant, so even a swallowed error cannot leave the member.
    it('a failing grant leaves no member and the invitation open', async () => {
      const doomed = job(1039);
      const { token: broken, invitation } = await invite('huda@example.com', 'hiring_owner', { jobIds: [doomed] });
      // A grant the database refuses, after the member row is written: the whole acceptance must roll back. sql.raw:
      // a CHECK constraint takes no bind parameter; `doomed` is a test constant.
      await admin.execute(
        sql`alter table workspaces.job_grant add constraint test_refuse_grant check (job_id is distinct from ${sql.raw(`'${doomed}'`)}::uuid)`,
      );
      try {
        await expect(
          workspaces.acceptInvitation({ userId: HUDA, email: 'huda@example.com' }, broken),
        ).rejects.toThrow();
      } finally {
        await admin.execute(sql`alter table workspaces.job_grant drop constraint test_refuse_grant`);
      }
      const members = await withWorkspace(app, gulf, (tx) =>
        tx.execute(sql`select 1 from workspaces.member where user_id = ${HUDA}`),
      );
      expect(members).toHaveLength(0);
      expect((await workspaces.findInvitation(broken))?.state).toBe('open');
      await asOmar((ctx) => workspaces.revokeInvitation(ctx, invitation.id));
    });
  });

  // SAFETY: mutation check: removed the status check in acceptInvitation -> this test failed (Huda joined the suspended workspace)
  it('a suspended workspace takes no new members: accepting is refused and nothing changes', async () => {
    const admin1 = user(1041);
    const paused = (await newWorkspace('Paused agency', admin1)).id;
    const { token } = await as(admin1, paused, (ctx) =>
      workspaces.inviteMember(ctx, {
        email: 'huda@example.com',
        role: 'recruiter',
        title: null,
        jobIds: [],
        clientIds: [],
      }),
    );
    await admin.execute(sql`update workspaces.workspace set status = 'suspended' where id = ${paused}`);
    await expect(workspaces.acceptInvitation({ userId: HUDA, email: 'huda@example.com' }, token)).rejects.toThrow(
      WorkspacePausedError,
    );
    expect(await workspaces.getMembership(HUDA, paused)).toBeNull();
    expect((await workspaces.findInvitation(token))?.state).toBe('open');
  });

  // SAFETY: mutation check: dropped the archivedAt filter in acceptInvitation -> this test failed (Falcon Pay was granted)
  // SAFETY: mutation check: removed the job_access.granted audit in acceptInvitation -> this test failed (no entry)
  it("accepting grants each job and client, audited, but not an archived client's jobs", async () => {
    const admin2 = user(1042);
    const member = user(1043);
    const agency = (await newWorkspace('Archive agency', admin2)).id;
    const asAdmin = <T>(fn: (ctx: WorkspaceContext) => Promise<T>) => as(admin2, agency, fn);
    await asAdmin((ctx) => workspaces.setWorkspaceType(ctx, 'agency'));
    const kept = await asAdmin((ctx) => workspaces.addClient(ctx, 'Dune Logistics'));
    const archived = await asAdmin((ctx) => workspaces.addClient(ctx, 'Falcon Pay'));
    const { token } = await asAdmin((ctx) =>
      workspaces.inviteMember(ctx, {
        email: 'faisal@example.com',
        role: 'hiring_owner',
        title: null,
        jobIds: [STAFF_BACKEND],
        clientIds: [kept.id, archived.id],
      }),
    );
    await asAdmin((ctx) => workspaces.archiveClient(ctx, archived.id));
    await workspaces.acceptInvitation({ userId: member, email: 'faisal@example.com' }, token);
    const grants = (await asAdmin((ctx) => workspaces.listJobGrants(ctx))).filter((g) => g.userId === member);
    expect(grants.map((g) => g.jobId ?? g.clientId).toSorted()).toEqual([STAFF_BACKEND, kept.id].toSorted());
    const granted = (await audit.listFor(agency, { type: 'member', id: member })).filter(
      (e) => e.action === 'job_access.granted',
    );
    expect(granted).toHaveLength(2);
  });

  // SAFETY: mutation check: used a fixed 7 days in inviteMember -> this test failed (7 days, not 3)
  it("an invitation stays open for the workspace's invitationDays setting", async () => {
    const admin3 = user(1044);
    const id = (await newWorkspace('Short invites', admin3)).id;
    await as(admin3, id, (ctx) => workspaces.updateSettings(ctx, { invitationDays: 3 }));
    const before = Date.now();
    const { invitation } = await as(admin3, id, (ctx) =>
      workspaces.inviteMember(ctx, {
        email: 'huda@example.com',
        role: 'recruiter',
        title: null,
        jobIds: [],
        clientIds: [],
      }),
    );
    expect(Math.round((invitation.expiresAt.getTime() - before) / 86_400_000)).toBe(3);
  });

  it('Scenario: An existing account joins a second workspace', async () => {
    const own = (await newWorkspace('Nadia Freelance', NADIA)).id;
    const { token } = await invite('nadia@example.com', 'recruiter');
    await workspaces.acceptInvitation({ userId: NADIA, email: 'nadia@example.com' }, token);
    expect(await workspaces.getMembership(NADIA, own)).toMatchObject({ role: 'admin' });
    expect(await workspaces.getMembership(NADIA, gulf)).toMatchObject({ role: 'recruiter' });
  });

  it('Scenario: Recruiters and admins get the whole workspace; giving them jobs is refused', async () => {
    const { invitation } = await invite('omar.agency@example.com', 'recruiter');
    expect(invitation).toMatchObject({ jobIds: [], clientIds: [] });
    await expect(invite('omar.agency@example.com', 'admin', { jobIds: [STAFF_BACKEND] })).rejects.toThrow(
      new WorkspaceError('jobs_not_allowed'),
    );
  });

  // SAFETY: mutation check: skipped the revoke loop in changeJobAccess -> this test failed (Staff Backend Engineer still allowed)
  it("Scenario: Changing a member's jobs takes effect on the next request, audited", async () => {
    const { token } = await invite('lina@example.com', 'interviewer', { jobIds: [STAFF_BACKEND, PM_PAYMENTS] });
    await workspaces.acceptInvitation({ userId: LINA, email: 'lina@example.com' }, token);
    expect(await openJob(LINA, STAFF_BACKEND, dune.id)).toBe('allowed');
    await asOmar((ctx) => workspaces.changeJobAccess(ctx, LINA, { jobIds: [PM_PAYMENTS], clientIds: [] }));
    expect(await openJob(LINA, STAFF_BACKEND, dune.id)).toBe('403');
    expect(await openJob(LINA, PM_PAYMENTS, falcon.id)).toBe('allowed');
    expect(await audit.listFor(gulf, { type: 'member', id: LINA })).toContainEqual(
      expect.objectContaining({
        action: 'job_access.revoked',
        before: expect.objectContaining({ jobId: STAFF_BACKEND }),
      }),
    );
  });

  describe('Scenario Outline: Expired, revoked and used invitations do nothing', () => {
    // SAFETY: mutation check: made invitationState ignore expiresAt -> the expired row failed (Huda joined)
    // SAFETY: mutation check: made invitationState ignore revokedAt -> the revoked row failed (Huda joined)
    it.each(['expired', 'revoked', 'accepted'])('%s', async (state) => {
      const { token, invitation } = await invite('huda@example.com', 'recruiter');
      if (state === 'expired')
        await withWorkspace(app, gulf, (tx) =>
          tx.execute(
            sql`update workspaces.invitation set expires_at = now() - interval '1 second' where id = ${invitation.id}`,
          ),
        );
      if (state === 'revoked') await asOmar((ctx) => workspaces.revokeInvitation(ctx, invitation.id));
      if (state === 'accepted') {
        await tryAccept(token);
        await asOmar((ctx) => workspaces.removeMember(ctx, HUDA));
      }
      expect((await workspaces.findInvitation(token))?.state).toBe(state);
      await expect(tryAccept(token)).rejects.toThrow(new WorkspaceError('invitation_invalid'));
      expect(await workspaces.getMembership(HUDA, gulf)).toBeNull();
    });

    it('a link that matches no invitation is invalid', async () => {
      expect(await workspaces.findInvitation(`${gulf}.not-a-token`)).toBeNull();
      expect(await workspaces.findInvitation('not-a-token')).toBeNull();
      await expect(tryAccept(`${gulf}.not-a-token`)).rejects.toThrow(new WorkspaceError('invitation_invalid'));
    });
  });

  // SAFETY: mutation check: removed authorize from inviteMember -> this test failed (the invitation was created)
  it('Scenario: Only an admin can invite: a recruiter gets 403 and no invitation is created', async () => {
    const count = (await listed()).length;
    await expect(
      as(RANA, gulf, (ctx) =>
        workspaces.inviteMember(ctx, {
          email: 'huda@example.com',
          role: 'recruiter',
          title: null,
          jobIds: [],
          clientIds: [],
        }),
      ),
    ).rejects.toThrow(ForbiddenError);
    expect(await listed()).toHaveLength(count);
  });

  // SAFETY: mutation check: removed assertCanChangeRole from removeMember -> this test failed (the last admin was removed)
  it('Scenario: The last admin cannot be removed', async () => {
    await expect(asOmar((ctx) => workspaces.removeMember(ctx, OMAR))).rejects.toThrow(new WorkspaceError('last_admin'));
    expect(await workspaces.getMembership(OMAR, gulf)).toMatchObject({ role: 'admin' });
  });

  it('removing a member ends their access and their grants, audited', async () => {
    await asOmar((ctx) => workspaces.removeMember(ctx, LINA));
    expect(await workspaces.getMembership(LINA, gulf)).toBeNull();
    expect((await asOmar((ctx) => workspaces.listJobGrants(ctx))).some((g) => g.userId === LINA)).toBe(false);
    expect(await audit.listFor(gulf, { type: 'member', id: LINA })).toContainEqual(
      expect.objectContaining({ action: 'member.removed' }),
    );
  });

  describe('Scenario: Invitations never cross workspaces', () => {
    let w1: string;

    beforeAll(async () => {
      w1 = (await newWorkspace('W1 invitations')).id;
      const w2 = (await newWorkspace('W2 invitations')).id;
      await as(ALEX, w2, (ctx) =>
        workspaces.inviteMember(ctx, {
          email: 'huda@example.com',
          role: 'recruiter',
          title: null,
          jobIds: [],
          clientIds: [],
        }),
      );
    });

    // SAFETY: mutation check: NO FORCE + DISABLE ROW LEVEL SECURITY on workspaces.invitation -> this test failed (saw the W2 invitation)
    // SAFETY: mutation check: replaced policy invitation_tenant_isolation with USING (true) -> this test failed (saw the W2 invitation)
    it('a W1 query with no WHERE clause returns no W2 invitation', async () => {
      const rows = await withWorkspace(app, w1, (tx) =>
        tx.execute<{ workspace_id: string }>(sql`select workspace_id from workspaces.invitation`),
      );
      expect(rows.filter((r) => r.workspace_id !== w1)).toEqual([]);
      expect(await as(ALEX, w1, (ctx) => workspaces.listInvitations(ctx))).toEqual([]);
    });
  });
});
