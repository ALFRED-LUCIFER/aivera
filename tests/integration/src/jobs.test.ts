import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { AuditContract } from '@credalent/audit';
import { createAudit } from '@credalent/audit/composition';
import { createDb, withWorkspace, type Db } from '@credalent/db';
import { JobError, type Competency, type CreateJobInput, type JobsContract } from '@credalent/jobs';
import { createJobs } from '@credalent/jobs/composition';
import {
  ForbiddenError,
  WorkspaceError,
  type Role,
  type WorkspaceContext,
  type WorkspacesContract,
} from '@credalent/workspaces';
import { createWorkspaces } from '@credalent/workspaces/composition';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// AIV-P1-005 acceptance scenarios against real PostgreSQL, connected as the non-owner aivera_app role (ADR-004, ADR-005).
// Synthetic cast only (docs/00-product/personas.md). The five demo jobs live here until the demo seed (AIV-P0-031).
// The scenarios build on each other in file order (Senior AI Engineer v1, then v2, then v3), as Vitest runs them.

const rolesSql = readFileSync(createRequire(import.meta.url).resolve('@credalent/db/sql/roles.sql'), 'utf8');
const dbCli = join(import.meta.dirname, '..', '..', '..', 'packages', 'db', 'src', 'cli.ts');

const ALEX = '0190d4a2-0000-7000-8000-00000000a1e1'; // admin of every workspace here
const RANA = '0190d4a2-0000-7000-8000-0000000052aa'; // recruiter in Demo
const HEAD = '0190d4a2-0000-7000-8000-0000000052bb'; // Head of Engineering, hiring owner in Demo
const FAISAL = '0190d4a2-0000-7000-8000-0000000052cc'; // hiring owner, Dune Logistics
const LINA = '0190d4a2-0000-7000-8000-0000000052dd'; // interviewer, granted J1 only
const NOW = new Date('2026-11-12T09:00:00.000Z');

let container: StartedPostgreSqlContainer;
let admin: Db;
let app: Db;
let audit: AuditContract;
let workspaces: WorkspacesContract;
let jobs: JobsContract;

const urlFor = (role: string) =>
  `postgres://${role}:local_dev_only@${container.getHost()}:${container.getPort()}/${container.getDatabase()}`;

const as = <T>(userId: string, workspaceId: string, fn: (ctx: WorkspaceContext) => Promise<T>) =>
  workspaces.withWorkspace({ userId }, workspaceId, fn);

const rows = <T extends Record<string, unknown>>(userId: string, workspaceId: string, query: ReturnType<typeof sql>) =>
  as(userId, workspaceId, async ({ tx }) => [...(await tx.execute<T>(query))]);

const newWorkspace = async (name: string) =>
  (await workspaces.createWorkspace({ name, company: name, hiringFocus: 'AI', synthetic: true, creatorUserId: ALEX }))
    .id;

const addMember = (workspaceId: string, userId: string, role: Role) =>
  withWorkspace(app, workspaceId, (tx) =>
    tx.execute(
      sql`insert into workspaces.member (workspace_id, user_id, role, status) values (${workspaceId}, ${userId}, ${role}, 'active')`,
    ),
  );

const competencies = (weights: number[], prefix = 'Competency'): Competency[] =>
  weights.map((weightPercent, i) => ({
    name: `${prefix} ${i + 1}`,
    evidenceExpected: 'A repository, a document or a reference',
    weightPercent,
    levelNeeded: 4,
    type: i < 2 ? 'mandatory' : 'desirable',
    origin: 'from_description',
  }));

// The ticket says 25, 20, 15, 15, 10 and 10, which totals 95; one 10 is 15 here so the valid rubric totals 100.
const SIX = [25, 20, 15, 15, 15, 10];

const job = (title: string, more: Partial<CreateJobInput> = {}): CreateJobInput => ({
  title,
  jobType: 'software_engineering',
  description: `${title}, synthetic demo job.`,
  synthetic: true,
  ...more,
});

/** Saves a rubric and, when `approver` is given, sends it for approval and approves it as them. */
const rubric = async (workspaceId: string, jobId: string, approver: string | null, prefix = 'Competency') => {
  const version = await as(ALEX, workspaceId, (ctx) =>
    jobs.saveRubric(ctx, jobId, {
      successStatement: 'Ships reliable work.',
      competencies: competencies(SIX, prefix),
    }),
  );
  if (approver) {
    await as(ALEX, workspaceId, (ctx) => jobs.submitRubric(ctx, version.id));
    await as(approver, workspaceId, (ctx) => jobs.approveRubric(ctx, version.id));
  }
  return version;
};

const statuses = (workspaceId: string, jobId: string) =>
  rows<{ version: number; status: string }>(
    ALEX,
    workspaceId,
    sql`select version, status from jobs.rubric_version where job_id = ${jobId} order by version`,
  );

/** The error a rejected promise carried, unwrapped from DbQueryError to the PostgreSQL error when there is one. */
const pgError = (promise: Promise<unknown>) =>
  promise.then(
    () => ({ code: 'none', constraint: undefined }),
    (error: { code?: string; constraint?: string; constraint_name?: string; cause?: unknown }) => {
      const pg = (error.cause ?? error) as { code?: string; constraint_name?: string };
      return { code: error.code ?? pg.code, constraint: error.constraint ?? pg.constraint_name };
    },
  );

// Demo workspace (in-house) with the five demo jobs; Gulf Talent Partners (agency) with J0 (own), J1 (Dune), J2 (Falcon).
let demo: string;
let gulf: string;
const demoJobs: Record<string, string> = {};
let j0: string;
let j1: string;
let j2: string;
let duneId: string;

beforeAll(async () => {
  container = await new PostgreSqlContainer('pgvector/pgvector:pg17').withDatabase('aivera').start();
  admin = createDb(container.getConnectionUri(), { max: 1 });
  await admin.$client.unsafe(rolesSql);
  execFileSync(process.execPath, [dbCli, 'migrate'], {
    env: { ...process.env, DATABASE_MIGRATOR_URL: urlFor('aivera_migrator') },
  });
  app = createDb(urlFor('aivera_app'), { max: 2 });
  audit = createAudit(app, () => NOW);
  workspaces = createWorkspaces(app, audit);
  jobs = createJobs(workspaces, audit, () => NOW);

  demo = await newWorkspace('Demo');
  await addMember(demo, RANA, 'recruiter');
  await addMember(demo, HEAD, 'hiring_owner');
  for (const [title, jobType] of [
    ['Senior AI Engineer', 'ai_llm_engineering'],
    ['Senior Product Manager, Payments', 'product_management'],
    ['QA Automation Engineer', 'qa_test_automation'],
    ['Staff Backend Engineer', 'software_engineering'],
    ['Senior Product Designer', 'product_design'],
  ] as const)
    demoJobs[title] = (await as(RANA, demo, (ctx) => jobs.createJob(ctx, job(title, { jobType })))).id;
  // HEAD owns these two jobs, so approves their rubrics (AIV-P1-014); owning a job grants it.
  for (const title of ['Senior AI Engineer', 'Staff Backend Engineer'])
    await as(ALEX, demo, (ctx) => jobs.changeHiringOwner(ctx, demoJobs[title] ?? '', HEAD));

  gulf = await newWorkspace('Gulf Talent Partners');
  await as(ALEX, gulf, (ctx) => workspaces.setWorkspaceType(ctx, 'agency'));
  const dune = await as(ALEX, gulf, (ctx) => workspaces.addClient(ctx, 'Dune Logistics'));
  duneId = dune.id;
  const falcon = await as(ALEX, gulf, (ctx) => workspaces.addClient(ctx, 'Falcon Pay'));
  j0 = (await as(ALEX, gulf, (ctx) => jobs.createJob(ctx, job('Recruitment Coordinator')))).id;
  j1 = (await as(ALEX, gulf, (ctx) => jobs.createJob(ctx, job('Staff Backend Engineer', { clientId: dune.id })))).id;
  j2 = (
    await as(ALEX, gulf, (ctx) =>
      jobs.createJob(
        ctx,
        job('Senior Product Manager, Payments', { clientId: falcon.id, jobType: 'product_management' }),
      ),
    )
  ).id;
  await addMember(gulf, FAISAL, 'hiring_owner');
  await addMember(gulf, LINA, 'interviewer');
  await as(ALEX, gulf, (ctx) => workspaces.grantJobAccess(ctx, { userId: FAISAL, clientId: dune.id }));
  await as(ALEX, gulf, (ctx) => workspaces.grantJobAccess(ctx, { userId: LINA, jobId: j1 }));
  for (const id of [j0, j1, j2]) await rubric(gulf, id, ALEX);
});

afterAll(async () => {
  await app?.$client.end();
  await admin?.$client.end();
  await container?.stop();
});

describe('Migrations', () => {
  // The catalogue_* platform tables have no workspace rows and no RLS (ADR-013 point 2; tenancy.test.ts lists them).
  it('jobs tables are owned by aivera_migrator with row-level security enabled and forced', async () => {
    const tables = await admin.execute<{ name: string; owner: string; rls: boolean; forced: boolean }>(sql`
      select t.tablename as name, t.tableowner as owner, c.relrowsecurity as rls, c.relforcerowsecurity as forced
      from pg_tables t join pg_class c on c.oid = format('%I.%I', t.schemaname, t.tablename)::regclass
      where t.schemaname = 'jobs' and t.tablename not like 'catalogue\_%' order by name`);
    expect([...tables]).toEqual(
      ['competency', 'job', 'outbox', 'public_job', 'rubric_version'].map((name) => ({
        name,
        owner: 'aivera_migrator',
        rls: true,
        forced: true,
      })),
    );
  });

  // public_job holds only what is public anyway, so it has no job scope; its read policy is for aivera_public (AIV-P3-002).
  // The outbox holds opaque ids only, read by the relay (AIV-P0-014, AIV-P1-014).
  it('each table has the tenant policy and a restrictive job-scope policy', async () => {
    const policies = await admin.execute<{ table: string; name: string; permissive: string }>(sql`
      select tablename as table, policyname as name, permissive from pg_policies where schemaname = 'jobs'
      order by tablename, policyname`);
    expect([...policies]).toEqual([
      { table: 'competency', name: 'competency_job_scope', permissive: 'RESTRICTIVE' },
      { table: 'competency', name: 'competency_tenant_isolation', permissive: 'PERMISSIVE' },
      { table: 'job', name: 'job_scope', permissive: 'RESTRICTIVE' },
      { table: 'job', name: 'job_tenant_isolation', permissive: 'PERMISSIVE' },
      { table: 'outbox', name: 'outbox_relay_mark', permissive: 'PERMISSIVE' },
      { table: 'outbox', name: 'outbox_relay_read', permissive: 'PERMISSIVE' },
      { table: 'outbox', name: 'outbox_tenant_isolation', permissive: 'PERMISSIVE' },
      { table: 'public_job', name: 'public_job_public_read', permissive: 'PERMISSIVE' },
      { table: 'public_job', name: 'public_job_tenant_isolation', permissive: 'PERMISSIVE' },
      { table: 'rubric_version', name: 'rubric_version_job_scope', permissive: 'RESTRICTIVE' },
      { table: 'rubric_version', name: 'rubric_version_tenant_isolation', permissive: 'PERMISSIVE' },
    ]);
  });
});

describe('Creating a job', () => {
  it('the five demo jobs start in "defining rubric", unpublished, synthetic, each audited as created', async () => {
    const list = await as(RANA, demo, (ctx) => jobs.listJobs(ctx));
    expect(list.map((j) => [j.title, j.stage, j.published, j.synthetic, j.createdAt])).toEqual(
      Object.keys(demoJobs).map((title) => [title, 'defining_rubric', false, true, NOW]),
    );
    const entries = await audit.listFor(demo, { type: 'job', id: demoJobs['Senior AI Engineer'] ?? '' });
    expect(entries).toMatchObject([{ action: 'job.created', actor: { type: 'user', id: RANA } }]);
  });

  it('a client from another workspace is refused, and a pay band is kept in minor units', async () => {
    const [falcon] = await rows<{ id: string }>(
      ALEX,
      gulf,
      sql`select id from workspaces.client where name = 'Falcon Pay'`,
    );
    await expect(
      as(ALEX, demo, (ctx) => jobs.createJob(ctx, job('Data Engineer', { clientId: falcon?.id ?? '' }))),
    ).rejects.toThrow(new JobError('client_not_found'));
    const created = await as(ALEX, demo, (ctx) =>
      jobs.createJob(
        ctx,
        job('Platform Engineer', { payBand: { minMinor: 3_000_000, maxMinor: 4_500_000, currency: 'AED' } }),
      ),
    );
    expect((await as(ALEX, demo, (ctx) => jobs.getJob(ctx, created.id)))?.payBand).toEqual({
      minMinor: 3_000_000,
      maxMinor: 4_500_000,
      currency: 'AED',
    });
  });

  it('interviewers and hiring owners cannot create jobs', async () => {
    await expect(as(HEAD, demo, (ctx) => jobs.createJob(ctx, job('Data Engineer')))).rejects.toThrow(ForbiddenError);
  });
});

describe('Scenario: A job owns its own rubric', () => {
  it('changing a competency in Senior AI Engineer leaves Staff Backend Engineer unchanged', async () => {
    const sae = demoJobs['Senior AI Engineer'] ?? '';
    const sbe = demoJobs['Staff Backend Engineer'] ?? '';
    await rubric(demo, sae, HEAD, 'AI');
    await rubric(demo, sbe, HEAD, 'Backend');
    const before = await as(ALEX, demo, (ctx) => jobs.getApprovedRubric(ctx, sbe));

    const changed = competencies(SIX, 'AI').map((c, i) => (i === 0 ? { ...c, name: 'LLM systems in production' } : c));
    await as(ALEX, demo, (ctx) =>
      jobs.saveRubric(ctx, sae, { successStatement: 'Ships LLM systems.', competencies: changed }),
    );

    expect(await as(ALEX, demo, (ctx) => jobs.getApprovedRubric(ctx, sbe))).toEqual(before);
    expect(before?.competencies.map((c) => c.name)).toEqual(competencies(SIX, 'Backend').map((c) => c.name));
  });
});

const qa = () => demoJobs['QA Automation Engineer'] ?? '';

describe('Scenario: Weights must total 100', () => {
  it('25, 20, 15, 15, 15 and 10 save; a total of 105 fails with "Weights must total 100%."', async () => {
    const saved = await as(ALEX, demo, (ctx) =>
      jobs.saveRubric(ctx, qa(), { successStatement: 'Finds defects early.', competencies: competencies(SIX) }),
    );
    expect(saved).toMatchObject({ version: 1, status: 'draft' });
    await expect(
      as(ALEX, demo, (ctx) =>
        jobs.saveRubric(ctx, qa(), {
          successStatement: 'Finds defects early.',
          competencies: competencies([30, 20, 15, 15, 15, 10]),
        }),
      ),
    ).rejects.toThrow('Weights must total 100%.');
    // Saving a draft again edits it in place: still one version.
    expect(await statuses(demo, qa())).toEqual([{ version: 1, status: 'draft' }]);
  });

  // SAFETY: mutation check: dropped trigger competency_weights_total_check -> this test failed (the update committed)
  it('the database refuses a total other than 100 at commit, even with the domain check bypassed', async () => {
    const result = await pgError(
      rows(
        ALEX,
        demo,
        sql`update jobs.competency set weight_percent = 30 where position = 0 and rubric_version_id =
          (select id from jobs.rubric_version where job_id = ${qa()})`,
      ),
    );
    expect(result).toEqual({ code: '23514', constraint: 'competency_weights_total_check' });
  });
});

describe('Scenario: Approving a version supersedes the previous one', () => {
  // SAFETY: mutation check: removed the supersede step from approveRubric -> this test failed (23505 one approved per job)
  it('the hiring owner approves version 2: version 2 is approved and version 1 superseded, audited', async () => {
    const sae = demoJobs['Senior AI Engineer'] ?? '';
    // Version 1 was approved above and version 2 drafted; send it for approval.
    const [v2] = await rows<{ id: string }>(
      ALEX,
      demo,
      sql`select id from jobs.rubric_version where job_id = ${sae} and version = 2`,
    );
    await as(ALEX, demo, (ctx) => jobs.submitRubric(ctx, v2?.id ?? ''));
    expect(await statuses(demo, sae)).toEqual([
      { version: 1, status: 'approved' },
      { version: 2, status: 'awaiting_approval' },
    ]);

    await as(HEAD, demo, (ctx) => jobs.approveRubric(ctx, v2?.id ?? ''));

    expect(await statuses(demo, sae)).toEqual([
      { version: 1, status: 'superseded' },
      { version: 2, status: 'approved' },
    ]);
    const approved = await as(HEAD, demo, (ctx) => jobs.getApprovedRubric(ctx, sae));
    expect(approved).toMatchObject({ version: 2, approvedBy: HEAD, approvedAt: NOW });
    const entries = await audit.listFor(demo, { type: 'rubric_version', id: v2?.id ?? '' });
    // AIV-P1-013: saving and sending it for approval are audited too.
    expect(entries).toMatchObject([
      { action: 'rubric.saved', after: { status: 'draft', version: 2 } },
      { action: 'rubric.submitted', actor: { type: 'user', id: ALEX }, after: { status: 'awaiting_approval' } },
      {
        action: 'rubric.approved',
        actor: { type: 'user', id: HEAD },
        before: { status: 'awaiting_approval' },
        after: { status: 'approved', jobId: sae, version: 2 },
      },
    ]);
  });

  // ADR-014: a draft may now be approved directly by an admin or recruiter; an approved version still cannot be again.
  it('a version already approved cannot be approved again', async () => {
    const approved = await as(ALEX, demo, (ctx) => jobs.getApprovedRubric(ctx, demoJobs['Senior AI Engineer'] ?? ''));
    await expect(as(ALEX, demo, (ctx) => jobs.approveRubric(ctx, approved?.id ?? ''))).rejects.toThrow(
      new JobError('version_status'),
    );
  });

  it("admins, recruiters and the job's own hiring owner approve; a hiring owner may not edit (ADR-014)", async () => {
    const sbe = demoJobs['Staff Backend Engineer'] ?? '';
    const v2 = await as(ALEX, demo, (ctx) =>
      jobs.saveRubric(ctx, sbe, { successStatement: 'Owns the backend.', competencies: competencies(SIX, 'Backend') }),
    );
    await as(ALEX, demo, (ctx) => jobs.submitRubric(ctx, v2.id));
    await expect(
      as(HEAD, demo, (ctx) => jobs.saveRubric(ctx, sbe, { successStatement: 'x', competencies: competencies([100]) })),
    ).rejects.toThrow(ForbiddenError);
  });
});

describe('Scenario: The approved rubric stays in force during a new draft', () => {
  it('with version 2 approved and version 3 awaiting approval, assessment receives version 2', async () => {
    const sae = demoJobs['Senior AI Engineer'] ?? '';
    const v3 = await as(ALEX, demo, (ctx) =>
      jobs.saveRubric(ctx, sae, {
        successStatement: 'Ships LLM systems at scale.',
        competencies: competencies([50, 50], 'v3'),
      }),
    );
    expect(v3.version).toBe(3);
    await as(ALEX, demo, (ctx) => jobs.submitRubric(ctx, v3.id));
    const approved = await as(ALEX, demo, (ctx) => jobs.getApprovedRubric(ctx, sae));
    expect(approved).toMatchObject({ version: 2, status: 'approved' });
    expect(approved?.competencies).toHaveLength(6);
  });
});

describe('Scenario: No approved rubric means no assessment input', () => {
  it('Senior Product Designer has only a draft, so assessment receives none', async () => {
    const spd = demoJobs['Senior Product Designer'] ?? '';
    await rubric(demo, spd, null);
    expect(await statuses(demo, spd)).toEqual([{ version: 1, status: 'draft' }]);
    expect(await as(ALEX, demo, (ctx) => jobs.getApprovedRubric(ctx, spd))).toBeNull();
  });
});

describe('Scenario: Jobs are isolated by workspace', () => {
  let w2: string;
  let dataEngineerId: string;
  beforeAll(async () => {
    w2 = await newWorkspace('Isolation W2');
    const dataEngineer = await as(ALEX, w2, (ctx) => jobs.createJob(ctx, job('Data Engineer', { jobType: 'data_ml' })));
    dataEngineerId = dataEngineer.id;
    await rubric(w2, dataEngineer.id, ALEX);
  });

  // SAFETY: mutation check: ALTER POLICY job_tenant_isolation, rubric_version_tenant_isolation and competency_tenant_isolation USING (true) -> this test failed (W2's rows were returned)
  it('a query in W1 (Demo) with no WHERE clause does not return W2\'s "Data Engineer" or its rubric', async () => {
    const titles = await rows<{ title: string; workspace_id: string }>(
      ALEX,
      demo,
      sql`select title, workspace_id from jobs.job`,
    );
    expect(titles.length).toBeGreaterThan(0);
    expect(titles.map((r) => r.title)).not.toContain('Data Engineer');
    for (const table of ['rubric_version', 'competency']) {
      const found = await rows<{ workspace_id: string }>(
        ALEX,
        demo,
        sql`select distinct workspace_id from ${sql.identifier('jobs')}.${sql.identifier(table)}`,
      );
      expect(found).toEqual([{ workspace_id: demo }]);
    }
  });

  // SAFETY: mutation check: the same USING (true) WITH CHECK (true) mutation -> this test failed (the insert succeeded)
  it("a write into another workspace is refused by the policy's WITH CHECK", async () => {
    const result = await pgError(
      rows(
        ALEX,
        demo,
        sql`insert into jobs.job (id, workspace_id, title, job_type, description, stage, published, synthetic, created_by, created_at)
          values (${crypto.randomUUID()}, ${w2}, 'Data Engineer', 'data_ml', '', 'defining_rubric', false, true, ${ALEX}, now())`,
      ),
    );
    expect(result.code).toBe('42501');
  });

  it("a rubric version cannot hang off another workspace's job", async () => {
    const result = await pgError(
      rows(
        ALEX,
        demo,
        sql`insert into jobs.rubric_version (id, workspace_id, job_id, version, status, success_statement, created_by, created_at)
          values (${crypto.randomUUID()}, ${demo}, ${dataEngineerId}, 9, 'draft', '', ${ALEX}, now())`,
      ),
    );
    // The job-scope policy's EXISTS cannot see W2's job, so the row-level security check refuses it first.
    expect(result.code).toMatch(/^(42501|23503)$/);
  });
});

describe('Scenario: A hiring owner sees only granted jobs, even at the database', () => {
  // SAFETY: mutation check: DROP POLICY job_scope ON jobs.job -> this test failed (Faisal saw J0, J1 and J2)
  it("Faisal, granted all of Dune Logistics' jobs, sees only J1 with no WHERE clause", async () => {
    const found = await rows<{ id: string }>(FAISAL, gulf, sql`select id from jobs.job`);
    expect(found).toEqual([{ id: j1 }]);
  });

  it('the same query with app.job_scope unset returns no rows', async () => {
    const found = await withWorkspace(app, gulf, (tx) => tx.execute(sql`select id from jobs.job`));
    expect([...found]).toEqual([]);
    const versions = await withWorkspace(app, gulf, (tx) => tx.execute(sql`select id from jobs.rubric_version`));
    expect([...versions]).toEqual([]);
  });

  // SAFETY: mutation check: DROP POLICY rubric_version_job_scope and competency_job_scope -> this test failed (Faisal read J0's and J2's rubric rows)
  it("Faisal cannot read another job's rubric or competencies, even with no WHERE clause", async () => {
    const versions = await rows<{ job_id: string }>(FAISAL, gulf, sql`select distinct job_id from jobs.rubric_version`);
    expect(versions).toEqual([{ job_id: j1 }]);
    const competencyJobs = await rows<{ job_id: string }>(
      FAISAL,
      gulf,
      sql`select distinct v.job_id from jobs.competency c left join jobs.rubric_version v on v.id = c.rubric_version_id`,
    );
    expect(competencyJobs).toEqual([{ job_id: j1 }]);
    const [count] = await rows<{ n: number }>(FAISAL, gulf, sql`select count(*)::int as n from jobs.competency`);
    expect(count?.n).toBe(SIX.length);
  });

  it('through the contract: listJobs, getJob and getApprovedRubric reach J1 only', async () => {
    expect((await as(FAISAL, gulf, (ctx) => jobs.listJobs(ctx))).map((j) => j.id)).toEqual([j1]);
    expect(await as(FAISAL, gulf, (ctx) => jobs.getJob(ctx, j2))).toBeNull();
    expect(await as(FAISAL, gulf, (ctx) => jobs.getApprovedRubric(ctx, j2))).toBeNull();
    expect((await as(FAISAL, gulf, (ctx) => jobs.getApprovedRubric(ctx, j1)))?.jobId).toBe(j1);
    expect((await as(ALEX, gulf, (ctx) => jobs.listJobs(ctx))).map((j) => j.id)).toEqual([j0, j1, j2]);
  });

  // SAFETY: mutation check: removed jobInScope from the repository's jobWhere -> this test failed (listJobs returned all three)
  it('the repository filters by job scope too: run as a superuser, which bypasses row-level security', async () => {
    const listed = await admin.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.workspace_id', ${gulf}, true), set_config('app.job_scope', 'granted', true),
        set_config('app.job_ids', '{}', true), set_config('app.client_ids', ${`{${duneId}}`}, true)`);
      return jobs.listJobs({ userId: FAISAL, workspaceId: gulf, role: 'hiring_owner', status: 'active', tx });
    });
    expect(listed.map((j) => j.id)).toEqual([j1]);
  });

  it("Faisal cannot approve Falcon Pay's rubric: the job is not found for him", async () => {
    const v = await as(ALEX, gulf, (ctx) =>
      jobs.saveRubric(ctx, j2, { successStatement: 'Owns payments.', competencies: competencies(SIX) }),
    );
    await as(ALEX, gulf, (ctx) => jobs.submitRubric(ctx, v.id));
    await expect(as(FAISAL, gulf, (ctx) => jobs.approveRubric(ctx, v.id))).rejects.toThrow(new JobError('not_found'));
  });
});

describe('An interviewer sees only the job granted to them', () => {
  it('Lina, granted J1, lists and reads only J1 and its rubric, and cannot approve it', async () => {
    expect((await as(LINA, gulf, (ctx) => jobs.listJobs(ctx))).map((j) => j.id)).toEqual([j1]);
    expect(await rows(LINA, gulf, sql`select job_id from jobs.rubric_version where job_id <> ${j1}`)).toEqual([]);
    expect(await as(LINA, gulf, (ctx) => jobs.getApprovedRubric(ctx, j0))).toBeNull();
    const [v] = await rows<{ id: string }>(ALEX, gulf, sql`select id from jobs.rubric_version where job_id = ${j1}`);
    await expect(as(LINA, gulf, (ctx) => jobs.approveRubric(ctx, v?.id ?? ''))).rejects.toThrow(ForbiddenError);
  });
});

describe('Database constraints (AGENTS.md 3.5)', () => {
  // SAFETY: mutation check: dropped index rubric_version_one_approved_idx -> this test failed (two approved versions)
  it('at most one approved version per job', async () => {
    const [v] = await rows<{ id: string }>(
      ALEX,
      gulf,
      sql`select id from jobs.rubric_version where job_id = ${j2} and status = 'awaiting_approval'`,
    );
    const result = await pgError(
      rows(
        ALEX,
        gulf,
        sql`update jobs.rubric_version set status = 'approved', approved_by = ${ALEX}, approved_at = now() where id = ${v?.id ?? ''}`,
      ),
    );
    expect(result).toEqual({ code: '23505', constraint: 'rubric_version_one_approved_idx' });
  });

  it('the level needed is 1 to 5', async () => {
    const result = await pgError(
      rows(
        ALEX,
        gulf,
        sql`update jobs.competency set level_needed = 6 where rubric_version_id in (select id from jobs.rubric_version where job_id = ${j2} and status = 'awaiting_approval')`,
      ),
    );
    expect(result).toEqual({ code: '23514', constraint: 'competency_level_check' });
  });

  // SAFETY: mutation check: dropped trigger competency_version_frozen_check -> this test failed (the approved competency changed)
  it("an approved version's competencies and content never change", async () => {
    const [approved] = await rows<{ id: string }>(
      ALEX,
      gulf,
      sql`select id from jobs.rubric_version where job_id = ${j1} and status = 'approved'`,
    );
    expect(
      await pgError(
        rows(
          ALEX,
          gulf,
          sql`update jobs.competency set name = 'Changed' where rubric_version_id = ${approved?.id ?? ''}`,
        ),
      ),
    ).toEqual({ code: '23514', constraint: 'competency_version_frozen_check' });
    expect(
      await pgError(
        rows(
          ALEX,
          gulf,
          sql`update jobs.rubric_version set success_statement = 'Changed' where id = ${approved?.id ?? ''}`,
        ),
      ),
    ).toEqual({ code: '23514', constraint: 'rubric_version_frozen_check' });
  });

  // SAFETY: mutation check: removed the status clause from refuse_approved_version_change -> this test failed (superseded went back to approved)
  it('a superseded version cannot become approved again', async () => {
    const sae = demoJobs['Senior AI Engineer'] ?? '';
    const swap = sql`update jobs.rubric_version set status = case status when 'approved' then 'superseded' else 'approved' end
      where job_id = ${sae} and status in ('approved', 'superseded')`;
    expect(await pgError(rows(ALEX, demo, swap))).toEqual({ code: '23514', constraint: 'rubric_version_frozen_check' });
  });

  it('an approved version records who approved it and when', async () => {
    const result = await pgError(
      rows(
        ALEX,
        gulf,
        sql`update jobs.rubric_version set status = 'superseded' where job_id = ${j2} and status = 'awaiting_approval'`,
      ),
    );
    expect(result).toEqual({ code: '23514', constraint: 'rubric_version_approval_check' });
  });
});

// AIV-P1-015: publishing a job on the candidate site (the commands; the rubric-page panel waits for AIV-P1-012).
const sae = () => demoJobs['Senior AI Engineer'] ?? '';
const publication = (jobId: string) =>
  rows<{ published: boolean; public_descriptor: string | null }>(
    ALEX,
    demo,
    sql`select published, public_descriptor from jobs.job where id = ${jobId}`,
  );

/** The job's JobPublished.v1 and JobUnpublished.v1 events in the jobs outbox, oldest first, read as the migrator. */
const listingEvents = async (jobId: string) =>
  [
    ...(await admin.execute<{ type: string }>(
      sql`select type from jobs.outbox where payload->>'jobId' = ${jobId} and type like 'Job%' order by id`,
    )),
  ].map((r) => r.type);

describe('Feature: Publish a job on the candidate site', () => {
  it('Scenario: Preview before publishing: the preview is the approved rubric, and the job stays unpublished', async () => {
    const listing = await as(RANA, demo, (ctx) => jobs.getPublicListing(ctx, sae()));
    expect(listing?.title).toBe('Senior AI Engineer');
    expect(listing?.competencies).toHaveLength(6);
    expect(await publication(sae())).toEqual([{ published: false, public_descriptor: null }]);
  });

  it('Scenario: The public listing contains only allowed fields', async () => {
    // The ticket's pay band; later tests in this file keep it, which none of them checks.
    await rows(
      ALEX,
      demo,
      sql`update jobs.job set pay_min_minor = 3500000, pay_max_minor = 4800000, pay_currency = 'AED' where id = ${sae()}`,
    );
    const listing = await as(RANA, demo, (ctx) => jobs.getPublicListing(ctx, sae()));
    expect(listing?.payBand).toEqual({ minMinor: 3_500_000, maxMinor: 4_800_000, currency: 'AED' });
    const approved = await rows<{ name: string; evidenceExpected: string; levelNeeded: number }>(
      ALEX,
      demo,
      sql`select c.name, c.evidence_expected as "evidenceExpected", c.level_needed as "levelNeeded"
        from jobs.competency c join jobs.rubric_version v on v.id = c.rubric_version_id
        where v.job_id = ${sae()} and v.status = 'approved' order by c.position`,
    );
    expect(listing?.competencies).toEqual(approved);
    expect(Object.keys(listing ?? {}).toSorted()).toEqual([
      'competencies',
      'descriptor',
      'jobType',
      'location',
      'payBand',
      'title',
    ]);
    for (const c of listing?.competencies ?? [])
      expect(Object.keys(c)).toEqual(['name', 'evidenceExpected', 'levelNeeded']);
  });

  it('Scenario: A job without an approved rubric cannot be published', async () => {
    const designer = demoJobs['Senior Product Designer'] ?? '';
    expect(await as(RANA, demo, (ctx) => jobs.getPublicListing(ctx, designer))).toBeNull();
    await expect(
      as(RANA, demo, (ctx) => jobs.publishJob(ctx, designer, { publicDescriptor: 'A design studio' })),
    ).rejects.toThrow('Publish after the rubric is approved.');
    expect(await publication(designer)).toEqual([{ published: false, public_descriptor: null }]);
  });

  // SAFETY: mutation check: removed the client-name check in publishJob -> this test failed (published as "Falcon Pay")
  it("the descriptor may not carry the client's name", async () => {
    for (const publicDescriptor of ['Falcon Pay', 'a fintech (falcon pay)'])
      await expect(as(ALEX, gulf, (ctx) => jobs.publishJob(ctx, j2, { publicDescriptor }))).rejects.toThrow(
        new JobError('public_descriptor'),
      );
  });

  it('a descriptor is required and at most 80 characters', async () => {
    for (const publicDescriptor of ['  ', 'x'.repeat(81)])
      await expect(as(RANA, demo, (ctx) => jobs.publishJob(ctx, sae(), { publicDescriptor }))).rejects.toThrow(
        new JobError('public_descriptor'),
      );
  });

  it('Scenario: Publish: the job is listed with its descriptor, and the audit log records who and when', async () => {
    await as(RANA, demo, (ctx) => jobs.publishJob(ctx, sae(), { publicDescriptor: '  A BNPL fintech ' }));
    expect(await publication(sae())).toEqual([{ published: true, public_descriptor: 'A BNPL fintech' }]);
    expect((await as(RANA, demo, (ctx) => jobs.getJob(ctx, sae())))?.publishedAt).toEqual(NOW);
    const entries = await audit.listFor(demo, { type: 'job', id: sae() });
    expect(entries.at(-1)).toMatchObject({
      action: 'job.published',
      actor: { type: 'user', id: RANA },
      occurredAt: NOW,
      after: { published: true, publicDescriptor: 'A BNPL fintech' },
    });
    // AIV-P1-015: JobPublished.v1 in the same transaction, and the header's "View public listing" slug.
    expect(await listingEvents(sae())).toEqual(['JobPublished.v1']);
    expect((await as(RANA, demo, (ctx) => jobs.getJobHeader(ctx, sae())))?.publicSlug).toMatch(/^senior-ai-engineer-/);
  });

  it('Scenario: Unpublish: the job is no longer listed, and unpublishing twice records one entry', async () => {
    await as(RANA, demo, (ctx) => jobs.unpublishJob(ctx, sae()));
    await as(RANA, demo, (ctx) => jobs.unpublishJob(ctx, sae()));
    expect(await publication(sae())).toEqual([{ published: false, public_descriptor: 'A BNPL fintech' }]);
    const actions = (await audit.listFor(demo, { type: 'job', id: sae() })).map((e) => e.action);
    expect(actions.filter((a) => a === 'job.unpublished')).toHaveLength(1);
    expect(await listingEvents(sae())).toEqual(['JobPublished.v1', 'JobUnpublished.v1']);
    expect((await as(RANA, demo, (ctx) => jobs.getJobHeader(ctx, sae())))?.publicSlug).toBeNull();
  });

  // SAFETY: mutation check: gave 'job.publish' to interviewers and hiring owners in permissions.ts -> this test failed
  it('Scenario: Interviewers cannot publish (nor hiring owners): 403', async () => {
    await expect(
      as(LINA, gulf, (ctx) => jobs.publishJob(ctx, j1, { publicDescriptor: 'A logistics platform' })),
    ).rejects.toThrow(ForbiddenError);
    await expect(as(LINA, gulf, (ctx) => jobs.unpublishJob(ctx, j1))).rejects.toThrow(ForbiddenError);
    await expect(as(HEAD, demo, (ctx) => jobs.getPublicListing(ctx, sae()))).rejects.toThrow(ForbiddenError);
  });

  // SAFETY: mutation check: dropped job_publication_check in the migration -> this test failed (no constraint error)
  it('the database refuses a published job without a descriptor', async () => {
    const result = await pgError(
      rows(ALEX, demo, sql`update jobs.job set published = true, public_descriptor = null where id = ${sae()}`),
    );
    expect(result).toEqual({ code: '23514', constraint: 'job_publication_check' });
  });
});

const desk = (userId: string, workspaceId: string) => as(userId, workspaceId, (ctx) => jobs.listJobsForDesk(ctx));

// Builds on the scenarios above: Senior Product Designer has only a draft; Senior AI Engineer has version 2 approved and
// version 3 awaiting approval.
describe('The Jobs list (AIV-P1-006)', () => {
  it('Senior Product Designer has a draft: assessed 0, coverage not yet available, "Send rubric for approval"', async () => {
    const list = await desk(ALEX, demo);
    expect(list.find((j) => j.title === 'Senior Product Designer')).toMatchObject({
      rubric: { approved: false, latest: 'draft' },
      assessed: 0,
      coveragePercent: null,
      nextAction: { kind: 'send_rubric' },
    });
    // Version 2 is in force and version 3 waits for the hiring owner.
    expect(list.find((j) => j.title === 'Senior AI Engineer')).toMatchObject({
      rubric: { approved: true, latest: 'awaiting_approval' },
      assessed: null,
      nextAction: { kind: 'rubric_approval_pending' },
    });
  });

  // SAFETY: mutation check: removed the workspace filter from jobWhere and ALTER POLICY job_tenant_isolation USING (true) -> this test failed (W2's "Data Engineer" was listed)
  it('another workspace\'s "Data Engineer" never shows', async () => {
    const w2 = await newWorkspace('Jobs list W2');
    await as(ALEX, w2, (ctx) => jobs.createJob(ctx, job('Data Engineer', { jobType: 'data_ml' })));
    expect((await desk(ALEX, w2)).map((j) => j.title)).toEqual(['Data Engineer']);
    expect((await desk(ALEX, demo)).map((j) => j.title)).not.toContain('Data Engineer');
  });

  // SAFETY: mutation check: DROP POLICY job_scope plus jobInScope removed from jobWhere -> this test failed (Faisal listed J0, J1 and J2)
  it('a hiring owner and an interviewer list only their granted job', async () => {
    expect((await desk(FAISAL, gulf)).map((j) => j.id)).toEqual([j1]);
    expect((await desk(LINA, gulf)).map((j) => j.id)).toEqual([j1]);
    expect((await desk(ALEX, gulf)).map((j) => j.id)).toEqual([j0, j1, j2]);
  });
});

// The Senior AI Engineer draft as kept: "Product judgement" removed, a competency of the recruiter's own added.
const draft = (overrides: Partial<Competency>[] = []): Competency[] =>
  [
    {
      name: 'LLM systems in production',
      weightPercent: 25,
      levelNeeded: 4,
      type: 'mandatory',
      origin: 'from_description',
    },
    {
      name: 'Retrieval and evaluation',
      weightPercent: 20,
      levelNeeded: 4,
      type: 'mandatory',
      origin: 'from_description',
    },
    {
      name: 'Python service engineering',
      weightPercent: 15,
      levelNeeded: 3,
      type: 'mandatory',
      origin: 'from_description',
    },
    {
      name: 'Cost and reliability',
      weightPercent: 15,
      levelNeeded: 2,
      type: 'desirable',
      origin: 'from_description',
    },
    {
      name: 'Arabic and bilingual NLP',
      weightPercent: 10,
      levelNeeded: 2,
      type: 'desirable',
      origin: 'suggested_by_aivera',
    },
    {
      name: 'Assistant operations',
      weightPercent: 10,
      levelNeeded: 3,
      type: 'desirable',
      origin: 'added_by_recruiter',
    },
  ].map((c, i) => ({ evidenceExpected: 'A repository or a document', ...c, ...overrides[i] }) as Competency);

describe('Feature: Save the job with rubric version 1 as a draft (AIV-P1-010)', () => {
  let w: string;
  const stored = (versionId: string) =>
    rows<{ name: string; weight: number; level: number; type: string; origin: string }>(
      ALEX,
      w,
      sql`select name, weight_percent as weight, level_needed as level, type, origin from jobs.competency
          where rubric_version_id = ${versionId} order by position`,
    );
  const jobCount = async () =>
    (await rows<{ n: number }>(ALEX, w, sql`select count(*)::int as n from jobs.job`))[0]?.n ?? -1;

  beforeAll(async () => {
    w = await newWorkspace('Rubric v1 Studio');
    await addMember(w, RANA, 'recruiter');
    await addMember(w, HEAD, 'hiring_owner');
  });

  it('Scenario: Weights rebalance when a suggestion was removed: job, version 1 draft, competencies and audit together', async () => {
    // "Product judgement" (15%) removed: the kept weights total 95, as the recruiter left them; level and type edited.
    const kept = draft([{}, {}, {}, { levelNeeded: 3, type: 'mandatory' }]);
    const { job: saved, rubricVersion } = await as(RANA, w, (ctx) =>
      jobs.createJobWithDraftRubric(ctx, {
        ...job('Senior AI Engineer', { jobType: 'ai_llm_engineering' }),
        competencies: kept,
      }),
    );
    expect(rubricVersion).toMatchObject({ jobId: saved.id, version: 1, status: 'draft', createdBy: RANA });
    const list = await stored(rubricVersion.id);
    expect(list.reduce((sum, c) => sum + c.weight, 0)).toBe(100);
    expect(list.map((c) => c.weight)).toEqual([29, 21, 15, 15, 10, 10]);
    // Scenario: Edit a level and type.
    expect(list[3]).toMatchObject({ name: 'Cost and reliability', level: 3, type: 'mandatory' });
    // Scenario: Kept suggestions are marked (AIV-P1-009), and a recruiter's own competency says so.
    expect(list.map((c) => c.origin)).toEqual([
      'from_description',
      'from_description',
      'from_description',
      'from_description',
      'suggested_by_aivera',
      'added_by_recruiter',
    ]);
    const entries = await audit.listFor(w, { type: 'job', id: saved.id });
    expect(entries).toMatchObject([
      { action: 'job.created', actor: { type: 'user', id: RANA }, after: { rubricVersionId: rubricVersion.id } },
    ]);
    // Scenario: Nothing is assessed from a draft: assessment reads only an approved version.
    expect(await as(RANA, w, (ctx) => jobs.getApprovedRubric(ctx, saved.id))).toBeNull();
    expect((await desk(RANA, w)).find((j) => j.id === saved.id)).toMatchObject({
      rubric: { approved: false, latest: 'draft' },
      assessed: 0,
    });
  });

  it('Scenario: Validation: no name or a level outside 1 to 5 stores nothing', async () => {
    const before = await jobCount();
    for (const [bad, code] of [
      [{ name: '  ' }, 'competency_name'],
      [{ levelNeeded: 6 }, 'level'],
      [{ levelNeeded: 0 }, 'level'],
    ] as const)
      await expect(
        as(RANA, w, (ctx) =>
          jobs.createJobWithDraftRubric(ctx, { ...job('Refused Engineer'), competencies: draft([bad]) }),
        ),
      ).rejects.toThrow(new JobError(code));
    expect(await jobCount()).toBe(before);
  });

  // SAFETY: mutation check: insertVersion wrapped in a savepoint (ctx.tx.transaction) whose error was swallowed -> this test failed (the job stayed)
  it('Scenario: Save fails: a competency the database refuses leaves no job behind', async () => {
    const before = await jobCount();
    const refused = draft([{ origin: 'imported' as Competency['origin'] }]);
    expect(
      await pgError(
        as(RANA, w, (ctx) =>
          jobs.createJobWithDraftRubric(ctx, { ...job('Half Saved Engineer'), competencies: refused }),
        ),
      ),
    ).toEqual({ code: '23514', constraint: 'competency_origin_check' });
    expect(await jobCount()).toBe(before);
  });

  // Feature: Suggest an industry's competencies in Add a job (AIV-P1-064), Scenario: I decide what stays.
  let packVersionId = '';
  const insert = (origin: string, packKey: string | null, packVersion: number | null) =>
    rows(
      ALEX,
      w,
      sql`insert into jobs.competency (id, workspace_id, rubric_version_id, name, evidence_expected, weight_percent,
            level_needed, type, origin, pack_key, pack_version, position)
          values (gen_random_uuid(), ${w}, ${packVersionId}, 'Ledger', '', 10, 3, 'desirable', ${origin}, ${packKey},
            ${packVersion}, 99)`,
    );
  it('Scenario: I decide what stays: a kept pack competency is saved with origin domain_pack, its pack and version', async () => {
    const kept = draft([
      {},
      {},
      {},
      {},
      { name: '3-D Secure and SCA flows', origin: 'domain_pack', packKey: 'payments_fintech', packVersion: 1 },
    ]);
    const { rubricVersion } = await as(RANA, w, (ctx) =>
      jobs.createJobWithDraftRubric(ctx, { ...job('Senior Backend Engineer, Payments'), competencies: kept }),
    );
    const list = await rows<{ name: string; origin: string; pack_key: string | null; pack_version: number | null }>(
      ALEX,
      w,
      sql`select name, origin, pack_key, pack_version from jobs.competency
          where rubric_version_id = ${rubricVersion.id} order by position`,
    );
    expect(list[4]).toEqual({
      name: '3-D Secure and SCA flows',
      origin: 'domain_pack',
      pack_key: 'payments_fintech',
      pack_version: 1,
    });
    expect(list.filter((c) => c.pack_key !== null)).toHaveLength(1);
  });

  // SAFETY: mutation check: dropped competency_domain_pack_check from migration 0007 -> this test failed (row stored)
  // SAFETY: mutation check: competency_pack_format_check without the regex in 0010 -> this test failed (Crypto stored)
  it('the database refuses a domain_pack competency without its pack, a pack on any other origin, or a malformed pack', async () => {
    // Its own draft version, so it does not hang on the test above.
    packVersionId = (
      await as(RANA, w, (ctx) =>
        jobs.createJobWithDraftRubric(ctx, { ...job('Pack Constraint Engineer'), competencies: draft() }),
      )
    ).rubricVersion.id;
    for (const [origin, key, v] of [
      ['domain_pack', null, null],
      ['domain_pack', 'payments_fintech', null],
      ['added_by_recruiter', 'payments_fintech', 1],
    ] as const)
      expect(await pgError(insert(origin, key, v))).toEqual({
        code: '23514',
        constraint: 'competency_domain_pack_check',
      });
    // By format since AIV-P2-043 (ADR-013 point 7): a well-formed key the catalogue lacks is the application's to refuse.
    for (const [key, v] of [
      ['Crypto', 1],
      ['payments_fintech', 0],
    ] as const)
      expect(await pgError(insert('domain_pack', key, v))).toEqual({
        code: '23514',
        constraint: 'competency_pack_format_check',
      });
  });

  it('a hiring owner cannot save a job with a rubric', async () => {
    await expect(
      as(HEAD, w, (ctx) => jobs.createJobWithDraftRubric(ctx, { ...job('Data Engineer'), competencies: draft() })),
    ).rejects.toThrow(ForbiddenError);
  });
});

describe('Feature: Pick the client and the hiring owner on Add a job (AIV-P1-056)', () => {
  const OWNER_A = '0190d4a2-0000-7000-8000-0000000056a1'; // Faisal Client, hiring owner with no grants
  const OWNER_B = '0190d4a2-0000-7000-8000-0000000056a2'; // Huda Client, hiring owner of Falcon Pay
  const PANEL = '0190d4a2-0000-7000-8000-0000000056a3'; // an interviewer
  let w: string;
  let dune: string;
  let falcon: string;
  let backend: string;
  let payments: string;
  const grantsOf = async (userId: string) =>
    (await as(ALEX, w, (ctx) => workspaces.listJobGrants(ctx)))
      .filter((g) => g.userId === userId)
      .map((g) => g.jobId ?? `client:${g.clientId}`);
  const canOpen = (userId: string, jobId: string, clientId: string) =>
    as(userId, w, (ctx) => workspaces.authorize(ctx, 'job.view', { jobId, clientId })).then(
      () => 'allowed',
      (error: unknown) => (error instanceof ForbiddenError ? '403' : String(error)),
    );

  beforeAll(async () => {
    w = await newWorkspace('Gulf Agency 056');
    await addMember(w, RANA, 'recruiter');
    await addMember(w, OWNER_A, 'hiring_owner');
    await addMember(w, OWNER_B, 'hiring_owner');
    await addMember(w, PANEL, 'interviewer');
    await as(ALEX, w, (ctx) => workspaces.setWorkspaceType(ctx, 'agency'));
    dune = (await as(RANA, w, (ctx) => workspaces.addClient(ctx, 'Dune Logistics'))).id;
    falcon = (await as(RANA, w, (ctx) => workspaces.addClient(ctx, 'Falcon Pay'))).id;
    payments = (
      await as(RANA, w, (ctx) =>
        jobs.createJobWithDraftRubric(ctx, {
          ...job('Senior Product Manager, Payments', { clientId: falcon }),
          competencies: competencies([100]),
        }),
      )
    ).job.id;
  });

  it('Scenario: Picking the hiring owner grants only that job', async () => {
    const { job: saved } = await as(RANA, w, (ctx) =>
      jobs.createJobWithDraftRubric(ctx, {
        ...job('Staff Backend Engineer', { clientId: dune, hiringOwnerUserId: OWNER_A }),
        competencies: competencies([100]),
      }),
    );
    backend = saved.id;
    expect(saved.clientId).toBe(dune);
    expect(await grantsOf(OWNER_A)).toEqual([backend]);
    expect(await canOpen(OWNER_A, backend, dune)).toBe('allowed');
    expect(await canOpen(OWNER_A, payments, falcon)).toBe('403');
    expect((await as(OWNER_A, w, (ctx) => jobs.listJobs(ctx))).map((j) => j.id)).toEqual([backend]);
    // The grant's audit entry is written in the same request, by the recruiter who saved the job.
    expect((await audit.listFor(w, { type: 'member', id: OWNER_A })).map((e) => e.action)).toEqual([
      'job_access.granted',
    ]);
  });

  // SAFETY: mutation check: skipped the revoke in setJobOwner -> this test failed (the previous owner kept the job)
  it('changing the hiring owner revokes the previous owner’s grant for that job', async () => {
    await as(RANA, w, (ctx) => jobs.changeHiringOwner(ctx, backend, OWNER_B));
    expect(await grantsOf(OWNER_A)).toEqual([]);
    expect(await grantsOf(OWNER_B)).toEqual([backend]);
    expect(await canOpen(OWNER_A, backend, dune)).toBe('403');
    expect((await as(ALEX, w, (ctx) => jobs.getJob(ctx, backend)))?.hiringOwnerUserId).toBe(OWNER_B);
  });

  it('a previous owner who holds a client grant keeps the client’s jobs', async () => {
    await as(ALEX, w, (ctx) => workspaces.grantJobAccess(ctx, { userId: OWNER_A, clientId: dune }));
    await as(RANA, w, (ctx) => jobs.changeHiringOwner(ctx, backend, OWNER_A));
    await as(RANA, w, (ctx) => jobs.changeHiringOwner(ctx, backend, null));
    expect(await grantsOf(OWNER_A)).toEqual([`client:${dune}`]);
    expect(await canOpen(OWNER_A, backend, dune)).toBe('allowed');
  });

  // SAFETY: mutation check: dropped the hiring_owner role check on the revoke -> this test failed (Panel's grant was deleted)
  it('an owner change never removes an interviewer’s grant', async () => {
    await as(ALEX, w, (ctx) => workspaces.grantJobAccess(ctx, { userId: PANEL, jobId: backend }));
    await as(RANA, w, (ctx) => workspaces.setJobOwner(ctx, { jobId: backend, previousOwnerId: PANEL, ownerId: null }));
    expect(await grantsOf(PANEL)).toEqual([backend]);
  });

  it('a hiring owner who is not an active hiring owner is refused and no job is saved', async () => {
    const before = (await as(ALEX, w, (ctx) => jobs.listJobs(ctx))).length;
    await expect(
      as(RANA, w, (ctx) => jobs.createJob(ctx, job('Data Engineer', { hiringOwnerUserId: PANEL }))),
    ).rejects.toThrow(new WorkspaceError('owner_role'));
    expect(await as(ALEX, w, (ctx) => jobs.listJobs(ctx))).toHaveLength(before);
  });

  it('a hiring owner cannot change who owns a job, nor add a client', async () => {
    // Faisal still sees the job through his client grant; seeing it is not owning it.
    await expect(as(OWNER_A, w, (ctx) => jobs.changeHiringOwner(ctx, backend, OWNER_A))).rejects.toThrow(
      ForbiddenError,
    );
    await expect(as(OWNER_B, w, (ctx) => workspaces.addClient(ctx, 'Oasis Freight'))).rejects.toThrow(ForbiddenError);
    expect((await as(ALEX, w, (ctx) => workspaces.listClients(ctx))).map((c) => c.name)).toEqual([
      'Dune Logistics',
      'Falcon Pay',
    ]);
  });
});
