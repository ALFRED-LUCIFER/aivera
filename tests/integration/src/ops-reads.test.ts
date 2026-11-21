import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { createAudit } from '@credalent/audit/composition';
import { createCandidates } from '@credalent/candidates/composition';
import { createDb, migrateModules, MODULES, migrationsFolder, withWorkspace, type Db } from '@credalent/db';
import type { JobCounts } from '@credalent/jobs';
import { createJobCounts, createJobs } from '@credalent/jobs/composition';
import type { MemberStatus, Role, WorkspaceDirectory, WorkspacesContract } from '@credalent/workspaces';
import { createWorkspaceDirectory, createWorkspaces } from '@credalent/workspaces/composition';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// AIV-P2-036 (ADR-012 point 6): the operator console's metadata read path against real PostgreSQL, as the non-owner
// aivera_app role under the unchanged tenant policies. The Background's workspaces; synthetic cast only (personas.md).

const rolesSql = readFileSync(createRequire(import.meta.url).resolve('@credalent/db/sql/roles.sql'), 'utf8');
const user = (n: number) => `0190d4a2-0000-7000-8000-${String(n).padStart(12, '0')}`;
const ALEX = user(1);
const OMAR = user(2);
const NADIA = user(3);
const PIA = user(9);
const EARLY = '0190d4a2-0000-7000-8000-0000000000e0'; // a workspace created before the directory existed
const EARLY_AT = new Date('2026-01-02T08:00:00.000Z');
const NOW = new Date('2026-11-19T09:00:00.000Z');

let container: StartedPostgreSqlContainer;
let admin: Db;
let app: Db;
let workspaces: WorkspacesContract;
let directory: WorkspaceDirectory;
let jobCounts: JobCounts;
const ids: Record<string, string> = {};

const urlFor = (role: string) =>
  `postgres://${role}:local_dev_only@${container.getHost()}:${container.getPort()}/${container.getDatabase()}`;

/** The workspaces module's migrations up to `last` only, in a temporary module folder. */
function workspacesUpTo(last: string) {
  const [module] = MODULES.filter((m) => m.name === 'workspaces');
  if (!module) throw new Error('workspaces module missing from MODULES');
  const dir = mkdtempSync(join(tmpdir(), 'credalent-workspaces-'));
  const folder = migrationsFolder({ name: 'workspaces', dir });
  cpSync(migrationsFolder(module), folder, { recursive: true });
  const journalPath = join(folder, 'meta', '_journal.json');
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: { tag: string }[] };
  const end = journal.entries.findIndex((e) => e.tag === last);
  writeFileSync(journalPath, JSON.stringify({ ...journal, entries: journal.entries.slice(0, end + 1) }));
  return { name: 'workspaces', dir };
}

const addMember = (workspaceId: string, userId: string, role: Role, status: MemberStatus = 'active') =>
  withWorkspace(app, workspaceId, (tx) =>
    tx.execute(sql`insert into workspaces.member (workspace_id, user_id, role, status)
      values (${workspaceId}, ${userId}, ${role}, ${status})`),
  );

async function workspaceWith(name: string, creator: string, members: number, jobs: number, synthetic: boolean) {
  const { id } = await workspaces.createWorkspace({
    name,
    company: name,
    hiringFocus: 'several',
    synthetic,
    creatorUserId: creator,
  });
  for (let n = 1; n < members; n++) await addMember(id, user(100 + Object.keys(ids).length * 10 + n), 'recruiter');
  const jobsModule = createJobs(workspaces, createAudit(app), () => NOW);
  await workspaces.withWorkspace({ userId: creator }, id, async (ctx) => {
    for (let n = 0; n < jobs; n++)
      await jobsModule.createJob(ctx, {
        title: `Synthetic job ${n + 1}`,
        jobType: 'software_engineering',
        description: 'Synthetic demo job.',
        synthetic: true,
      });
  });
  ids[name] = id;
  return id;
}

beforeAll(async () => {
  container = await new PostgreSqlContainer('pgvector/pgvector:pg17').withDatabase('aivera').start();
  admin = createDb(container.getConnectionUri(), { max: 1 });
  await admin.$client.unsafe(rolesSql);
  const migrator = urlFor('aivera_migrator');
  // The database as it was before AIV-P2-036: a workspace exists, and it is its creator's active workspace.
  const audit = MODULES.filter((m) => m.name === 'audit');
  const before = workspacesUpTo('0006_force_rls_ai_token_usage');
  await migrateModules(migrator, [...audit, before]);
  rmSync(before.dir, { recursive: true });
  app = createDb(urlFor('aivera_app'), { max: 2 });
  await withWorkspace(app, EARLY, async (tx) => {
    await tx.execute(sql`insert into workspaces.workspace (id, name, company, hiring_focus, synthetic, created_at)
      values (${EARLY}, 'Early Synthetic Team', 'Early Synthetic Team', 'several', true, ${EARLY_AT.toISOString()})`);
    await tx.execute(
      sql`insert into workspaces.active_workspace (user_id, workspace_id) values (${user(50)}, ${EARLY})`,
    );
  });
  await migrateModules(migrator, MODULES);

  workspaces = createWorkspaces(app, createAudit(app));
  directory = createWorkspaceDirectory(app);
  jobCounts = createJobCounts(app);
  const demo = await workspaceWith('Demo Hiring Co', ALEX, 3, 5, true);
  const gulf = await workspaceWith('Gulf Talent Partners', OMAR, 4, 2, false);
  await workspaceWith('Nadia Freelance', NADIA, 1, 0, false);
  // An invited and a removed member are not counted.
  await addMember(gulf, user(60), 'interviewer', 'removed');
  await addMember(gulf, user(61), 'interviewer', 'invited');
  await workspaces.withWorkspace({ userId: OMAR }, gulf, (ctx) => workspaces.setWorkspaceType(ctx, 'agency'));
  // Candidate data in Demo Hiring Co, so a leak would have something to show.
  await workspaces.withWorkspace({ userId: ALEX }, demo, (ctx) =>
    createCandidates(workspaces, () => NOW).findOrCreatePerson(ctx, {
      displayName: 'Sara Al Qahtani',
      identifiers: [{ type: 'email', value: 'sara@example.com' }],
      synthetic: true,
    }),
  );
});

afterAll(async () => {
  await app?.$client.end();
  await admin?.$client.end();
  await container?.stop();
});

const facts = (name: string, type: 'in_house' | 'agency', synthetic: boolean, activeMembers: number) => ({
  id: ids[name],
  name,
  type,
  createdAt: expect.any(Date),
  synthetic,
  status: 'active',
  activeMembers,
});

describe('Scenario: Listing workspaces (the read contracts)', () => {
  // SAFETY: mutation check: added `company: workspace.company` to readSummary's select -> this test failed (extra field)
  it('lists every workspace newest first with only its platform facts, and counts its jobs', async () => {
    const { total, summaries } = await directory.listSummaries({ query: '', offset: 0, limit: 50 });
    expect(total).toBe(4);
    expect(summaries).toEqual([
      facts('Nadia Freelance', 'in_house', false, 1),
      facts('Gulf Talent Partners', 'agency', false, 4),
      facts('Demo Hiring Co', 'in_house', true, 3),
      {
        id: EARLY,
        name: 'Early Synthetic Team',
        type: 'in_house',
        createdAt: EARLY_AT,
        synthetic: true,
        status: 'active',
        activeMembers: 0,
      },
    ]);
    expect(await Promise.all(summaries.map((s) => jobCounts.countJobs(s.id)))).toEqual([0, 2, 5, 0]);
  });

  it('Scenario: Searching by name: "gulf" finds only Gulf Talent Partners; paging takes `limit` from `offset`', async () => {
    expect(await directory.listSummaries({ query: 'gulf', offset: 0, limit: 50 })).toEqual({
      total: 1,
      summaries: [facts('Gulf Talent Partners', 'agency', false, 4)],
    });
    const page2 = await directory.listSummaries({ query: '', offset: 1, limit: 2 });
    expect([page2.total, page2.summaries.map((s) => s.name)]).toEqual([4, ['Gulf Talent Partners', 'Demo Hiring Co']]);
  });

  it('an unknown workspace has no summary and no jobs', async () => {
    expect(await directory.getSummary(user(77))).toBeNull();
    expect(await jobCounts.countJobs(user(77))).toBe(0);
  });
});

describe('AIV-P2-051: the console home counts (listStatuses) and the status filter', () => {
  // SAFETY: mutation check: added `name: workspace.name` to readStatus's select -> this test failed (extra field)
  it("returns each workspace's opaque id, status and created date only, each read in its own scope", async () => {
    const statuses = await directory.listStatuses();
    expect(statuses).toHaveLength(4);
    for (const s of statuses) expect(Object.keys(s).toSorted()).toEqual(['createdAt', 'id', 'status']);
    expect(statuses.find((s) => s.id === EARLY)).toEqual({ id: EARLY, status: 'active', createdAt: EARLY_AT });
    expect(JSON.stringify(statuses)).not.toMatch(/Demo Hiring Co|Gulf Talent Partners|Sara/);
  });

  it('another workspace stays invisible under one workspace scope: RLS, not only the id filter', async () => {
    const demo = ids['Demo Hiring Co'] ?? '';
    const gulf = ids['Gulf Talent Partners'] ?? '';
    const seen = await withWorkspace(app, demo, (tx) => tx.execute(sql`select id, status from workspaces.workspace`));
    expect([...seen].map((r) => r.id)).toEqual([demo]);
    expect(seen).not.toContainEqual(expect.objectContaining({ id: gulf }));
  });

  it('counts a suspended workspace under its status, and listSummaries filters by it', async () => {
    const nadia = ids['Nadia Freelance'] ?? '';
    const change = (c: 'suspend' | 'reactivate') =>
      workspaces.changeStatus({
        operatorId: user(8), // not Pia: the platform log test below expects her entry alone
        workspaceId: nadia,
        change: c,
        reason: 'Synthetic integration check',
      });
    await change('suspend');
    try {
      expect((await directory.listStatuses()).find((s) => s.id === nadia)?.status).toBe('suspended');
      const suspended = await directory.listSummaries({ query: '', offset: 0, limit: 50, status: 'suspended' });
      expect([suspended.total, suspended.summaries.map((s) => s.name)]).toEqual([1, ['Nadia Freelance']]);
      expect((await directory.listSummaries({ query: '', offset: 0, limit: 50, status: 'active' })).total).toBe(3);
    } finally {
      await change('reactivate');
    }
  });
});

describe('Scenario: The console never returns candidate data', () => {
  // SAFETY: mutation check: made readSummary return the member rows as well -> this test failed (named user ids)
  it('the list, detail and job count for Demo Hiring Co hold no candidate name, email or member', async () => {
    const demo = ids['Demo Hiring Co'] ?? '';
    const responses = JSON.stringify([
      await directory.listSummaries({ query: 'demo', offset: 0, limit: 50 }),
      await directory.getSummary(demo),
      await jobCounts.countJobs(demo),
    ]);
    expect(responses).toContain('Demo Hiring Co');
    for (const leak of ['Sara', 'sara@example.com', 'Synthetic job', ALEX]) expect(responses).not.toContain(leak);
  });
});

describe('the directory (ADR-012 point 6)', () => {
  it('the migration lists a workspace that existed before it, with its real created date', async () => {
    const rows = await admin.execute(
      sql`select workspace_id as id, created_at = ${EARLY_AT.toISOString()}::timestamptz as "createdThen"
        from workspaces.directory where workspace_id = ${EARLY}`,
    );
    expect([...rows]).toEqual([{ id: EARLY, createdThen: true }]);
  });

  it('holds only the workspace id and created date: no name or anything a tenant wrote', async () => {
    const columns = await admin.execute<{ name: string }>(
      sql`select column_name as name from information_schema.columns
        where table_schema = 'workspaces' and table_name = 'directory' order by ordinal_position`,
    );
    expect([...columns].map((c) => c.name)).toEqual(['workspace_id', 'created_at']);
  });

  // SAFETY: mutation check: removed the directory delete from deleteWorkspace -> this test failed (foreign key violation)
  it('the synthetic purge removes the workspace from the directory too', async () => {
    const id = await workspaceWith('Purged Synthetic Team', ALEX, 1, 0, true);
    await workspaces.withWorkspace({ userId: ALEX }, id, (ctx) => workspaces.purgeSyntheticWorkspace(ctx));
    expect(await directory.getSummary(id)).toBeNull();
    const [left] = await admin.execute<{ n: number }>(
      sql`select count(*)::int as n from workspaces.directory where workspace_id = ${id}`,
    );
    expect(left?.n).toBe(0);
  });
});

describe('Scenario: Opening a workspace (the platform audit log)', () => {
  it('records "ops.workspace_viewed" with the operator, the workspace and the time', async () => {
    const gulf = ids['Gulf Talent Partners'] ?? '';
    await createAudit(app, () => NOW).recordPlatform({
      actorId: PIA,
      action: 'ops.workspace_viewed',
      subject: { type: 'workspace', id: gulf },
    });
    const rows = await admin.execute(
      sql`select actor_id, action, subject_type, subject_id, occurred_at = ${NOW.toISOString()}::timestamptz as "atNow"
        from audit.platform_entry where actor_id = ${PIA}`,
    );
    expect([...rows]).toEqual([
      { actor_id: PIA, action: 'ops.workspace_viewed', subject_type: 'workspace', subject_id: gulf, atNow: true },
    ]);
  });
});
