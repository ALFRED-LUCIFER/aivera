import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { AuditContract } from '@aivera/audit';
import { createAudit } from '@aivera/audit/composition';
import { createDb, withWorkspace, type Db } from '@aivera/db';
import { JobError, type Competency, type CreateJobInput, type JobsContract } from '@aivera/jobs';
import { createJobs } from '@aivera/jobs/composition';
import { ForbiddenError, type Role, type WorkspaceContext, type WorkspacesContract } from '@aivera/workspaces';
import { createWorkspaces } from '@aivera/workspaces/composition';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// AIV-P1-005 acceptance scenarios against real PostgreSQL, connected as the non-owner aivera_app role (ADR-004, ADR-005).
// Synthetic cast only (docs/00-product/personas.md). The five demo jobs live here until the demo seed (AIV-P0-031).

const rolesSql = readFileSync(createRequire(import.meta.url).resolve('@aivera/db/sql/roles.sql'), 'utf8');
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
  for (const title of ['Senior AI Engineer', 'Staff Backend Engineer'])
    await as(ALEX, demo, (ctx) => workspaces.grantJobAccess(ctx, { userId: HEAD, jobId: demoJobs[title] ?? '' }));

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
  it('jobs tables are owned by aivera_migrator with row-level security enabled and forced', async () => {
    const tables = await admin.execute<{ name: string; owner: string; rls: boolean; forced: boolean }>(sql`
      select t.tablename as name, t.tableowner as owner, c.relrowsecurity as rls, c.relforcerowsecurity as forced
      from pg_tables t join pg_class c on c.oid = format('%I.%I', t.schemaname, t.tablename)::regclass
      where t.schemaname = 'jobs' order by name`);
    expect([...tables]).toEqual(
      ['competency', 'job', 'rubric_version'].map((name) => ({
        name,
        owner: 'aivera_migrator',
        rls: true,
        forced: true,
      })),
    );
  });

  it('each table has the tenant policy and a restrictive job-scope policy', async () => {
    const policies = await admin.execute<{ table: string; name: string; permissive: string }>(sql`
      select tablename as table, policyname as name, permissive from pg_policies where schemaname = 'jobs'
      order by tablename, policyname`);
    expect([...policies]).toEqual([
      { table: 'competency', name: 'competency_job_scope', permissive: 'RESTRICTIVE' },
      { table: 'competency', name: 'competency_tenant_isolation', permissive: 'PERMISSIVE' },
      { table: 'job', name: 'job_scope', permissive: 'RESTRICTIVE' },
      { table: 'job', name: 'job_tenant_isolation', permissive: 'PERMISSIVE' },
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
    expect(entries).toMatchObject([
      {
        action: 'rubric.approved',
        actor: { type: 'user', id: HEAD },
        before: { status: 'awaiting_approval' },
        after: { status: 'approved', jobId: sae, version: 2 },
      },
    ]);
  });

  it('a version that is not awaiting approval cannot be approved', async () => {
    const [draft] = await rows<{ id: string }>(
      ALEX,
      demo,
      sql`select id from jobs.rubric_version where job_id = ${demoJobs['QA Automation Engineer'] ?? ''}`,
    );
    await expect(as(ALEX, demo, (ctx) => jobs.approveRubric(ctx, draft?.id ?? ''))).rejects.toThrow(
      new JobError('version_status'),
    );
  });

  it('only admins and the granted hiring owner approve', async () => {
    const sbe = demoJobs['Staff Backend Engineer'] ?? '';
    const v2 = await as(ALEX, demo, (ctx) =>
      jobs.saveRubric(ctx, sbe, { successStatement: 'Owns the backend.', competencies: competencies(SIX, 'Backend') }),
    );
    await as(ALEX, demo, (ctx) => jobs.submitRubric(ctx, v2.id));
    await expect(as(RANA, demo, (ctx) => jobs.approveRubric(ctx, v2.id))).rejects.toThrow(ForbiddenError);
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
      return jobs.listJobs({ userId: FAISAL, workspaceId: gulf, role: 'hiring_owner', tx });
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
