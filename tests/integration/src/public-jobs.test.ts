import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { createAudit } from '@aivera/audit/composition';
import { createDb, type Db } from '@aivera/db';
import { toPublicJobJson, type Competency, type JobsContract, type PublicJobsContract } from '@aivera/jobs';
import { createJobs, createPublicJobs } from '@aivera/jobs/composition';
import type { WorkspaceContext, WorkspacesContract } from '@aivera/workspaces';
import { createWorkspaces } from '@aivera/workspaces/composition';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// AIV-P3-002 against real PostgreSQL: the public read model is written by publishing and approval in the workspace
// transaction (as aivera_app) and read with no workspace as aivera_public. Synthetic cast (docs/00-product/personas.md).
// The scenarios build on each other in file order.

const rolesSql = readFileSync(createRequire(import.meta.url).resolve('@aivera/db/sql/roles.sql'), 'utf8');
const dbCli = join(import.meta.dirname, '..', '..', '..', 'packages', 'db', 'src', 'cli.ts');
const ALEX = '0190d4a2-0000-7000-8000-00000000a1e1'; // admin of the demo workspace
const NOW = new Date('2026-11-12T09:00:00.000Z');

let container: StartedPostgreSqlContainer;
let admin: Db;
let app: Db;
let workspaces: WorkspacesContract;
let jobs: JobsContract;
let publicJobs: PublicJobsContract;
let demo: string;
let sae: string;
let qa: string;

const urlFor = (role: string) =>
  `postgres://${role}:local_dev_only@${container.getHost()}:${container.getPort()}/${container.getDatabase()}`;
const as = <T>(fn: (ctx: WorkspaceContext) => Promise<T>) => workspaces.withWorkspace({ userId: ALEX }, demo, fn);

const SAE_RUBRIC: [string, number, number][] = [
  ['LLM systems in production', 25, 4],
  ['Retrieval and evaluation', 20, 4],
  ['Python service engineering', 15, 3],
  ['Product judgement', 15, 3],
  ['Data privacy by design', 15, 3],
  ['Clear technical writing', 10, 3],
];
const rubricOf = (rows: [string, number, number][]): Competency[] =>
  rows.map(([name, weightPercent, levelNeeded], i) => ({
    name,
    evidenceExpected: 'A shipped system with real users, and their part in it',
    weightPercent,
    levelNeeded,
    type: i < 2 ? 'mandatory' : 'desirable',
    origin: 'from_description',
  }));

/** Saves the rubric and, unless `draft`, sends and approves it. */
async function rubric(jobId: string, competencies: Competency[], draft = false) {
  const version = await as((ctx) => jobs.saveRubric(ctx, jobId, { successStatement: 'Ships.', competencies }));
  if (draft) return;
  await as((ctx) => jobs.submitRubric(ctx, version.id));
  await as((ctx) => jobs.approveRubric(ctx, version.id));
}

/** Runs `query` as aivera_public, as the public reads do, and returns the PostgreSQL error code ('none' if allowed). */
const asPublicRole = (query: ReturnType<typeof sql>) =>
  app
    .transaction(async (tx) => {
      await tx.execute(sql`set local role aivera_public`);
      await tx.execute(query);
    })
    .then(
      () => 'none',
      (error: { code?: string; cause?: { code?: string } }) => error.cause?.code ?? error.code,
    );

const listed = async () => (await publicJobs.listPublicJobs()).map((j) => j.title);
/** The level the public listing shows for Senior AI Engineer's first competency. */
const level = async () =>
  (await publicJobs.listPublicJobs())
    .find((j) => j.title === 'Senior AI Engineer')
    ?.competencies.find((c) => c.name === 'LLM systems in production')?.levelNeeded;
const slugOf = async (title: string) => (await publicJobs.listPublicJobs()).find((j) => j.title === title)?.slug ?? '';

beforeAll(async () => {
  container = await new PostgreSqlContainer('pgvector/pgvector:pg17').withDatabase('aivera').start();
  admin = createDb(container.getConnectionUri(), { max: 1 });
  await admin.$client.unsafe(rolesSql);
  execFileSync(process.execPath, [dbCli, 'migrate'], {
    env: { ...process.env, DATABASE_MIGRATOR_URL: urlFor('aivera_migrator') },
  });
  app = createDb(urlFor('aivera_app'), { max: 2 });
  const audit = createAudit(app, () => NOW);
  workspaces = createWorkspaces(app, audit);
  jobs = createJobs(workspaces, audit, () => NOW);
  publicJobs = createPublicJobs(app);
  demo = (
    await workspaces.createWorkspace({
      name: 'Demo Hiring Co',
      company: 'Demo Hiring Co',
      hiringFocus: 'AI',
      synthetic: true,
      creatorUserId: ALEX,
    })
  ).id;
  const create = (title: string, jobType: 'ai_llm_engineering' | 'qa_test_automation', more = {}) =>
    as((ctx) => jobs.createJob(ctx, { title, jobType, description: `${title}, synthetic.`, synthetic: true, ...more }));
  sae = (
    await create('Senior AI Engineer', 'ai_llm_engineering', {
      location: 'DIFC, Dubai',
      payBand: { minMinor: 3_500_000, maxMinor: 4_800_000, currency: 'AED' },
    })
  ).id;
  qa = (await create('QA Automation Engineer', 'qa_test_automation', { location: 'Dubai, hybrid' })).id;
  // Version 1 then version 2 approved, so the job is published on version 2 as the scenario says.
  await rubric(sae, rubricOf(SAE_RUBRIC.map(([n, w]) => [n, w, 3])));
  await rubric(sae, rubricOf(SAE_RUBRIC));
  await rubric(qa, rubricOf(SAE_RUBRIC.map(([, w, l], i) => [`QA competency ${i + 1}`, w, l])));
}, 180_000);

afterAll(async () => {
  await app?.$client.end();
  await admin?.$client.end();
  await container?.stop();
});

describe('Feature: Public read model of published jobs', () => {
  it('Scenario: Publishing a job creates its public listing', async () => {
    expect(await listed()).toEqual([]);
    await as((ctx) => jobs.publishJob(ctx, sae, { publicDescriptor: 'A BNPL fintech' }));
    const [job] = await publicJobs.listPublicJobs();
    expect(job).toMatchObject({
      title: 'Senior AI Engineer',
      descriptor: 'A BNPL fintech',
      location: 'DIFC, Dubai',
      payBand: { minMinor: 3_500_000, maxMinor: 4_800_000, currency: 'AED' },
      postedAt: NOW,
    });
    expect(job?.slug).toMatch(/^senior-ai-engineer-[0-9a-f]{12}$/);
    expect(job?.competencies).toHaveLength(6);
    expect(job?.competencies[0]).toEqual({
      name: 'LLM systems in production',
      evidenceExpected: 'A shipped system with real users, and their part in it',
      levelNeeded: 4,
    });
  });

  it('Scenario: Hidden fields never leave the server', async () => {
    const found = await publicJobs.findPublicJob(await slugOf('Senior AI Engineer'));
    if (!found?.open) throw new Error('expected an open job');
    const json = JSON.stringify(toPublicJobJson(found.job));
    for (const hidden of ['weight', 'workspace', sae, demo, 'client', 'score', 'candidate', 'Ships.'])
      expect(json).not.toContain(hidden);
  });

  it('Scenario: Pay band not disclosed', async () => {
    await as((ctx) => jobs.publishJob(ctx, qa, { publicDescriptor: 'A logistics platform' }));
    const found = await publicJobs.findPublicJob(await slugOf('QA Automation Engineer'));
    expect(found).toMatchObject({ open: true, job: { payBand: null, location: 'Dubai, hybrid' } });
  });

  it('Scenario: Unpublishing removes the listing at once; the old link says it is no longer open', async () => {
    const slug = await slugOf('Senior AI Engineer');
    await as((ctx) => jobs.unpublishJob(ctx, sae));
    expect(await listed()).toEqual(['QA Automation Engineer']);
    expect(await publicJobs.findPublicJob(slug)).toEqual({ open: false });
    expect(await publicJobs.findPublicJob('no-such-job-000000')).toBeNull();
    // Publishing again reopens the same address, so links shared before keep working.
    await as((ctx) => jobs.publishJob(ctx, sae, { publicDescriptor: 'A BNPL fintech' }));
    expect(await slugOf('Senior AI Engineer')).toBe(slug);
  });

  it('Scenario: A new approved rubric version updates the listing; a draft never appears', async () => {
    await rubric(sae, rubricOf(SAE_RUBRIC.map(([n, w, l], i) => [n, w, i === 0 ? 5 : l])));
    expect(await level()).toBe(5);
    await rubric(sae, rubricOf(SAE_RUBRIC.map(([n, w]) => [n, w, 1])), true);
    expect(await level()).toBe(5);
  });

  // SAFETY: mutation check: GRANT SELECT ON candidates.person TO aivera_public (and USAGE on its schema) -> this test failed
  it('Scenario: The public role cannot read private tables, nor the private columns of its own', async () => {
    for (const query of [
      sql`select * from candidates.person`,
      sql`select * from workspaces.member`,
      sql`select * from jobs.job`,
      sql`select * from jobs.competency`,
      sql`select * from audit.entry`,
      sql`select workspace_id from jobs.public_job`,
      sql`select job_id from jobs.public_job`,
      sql`update jobs.public_job set open = true`,
    ])
      expect(await asPublicRole(query)).toBe('42501');
    expect(await asPublicRole(sql`select slug, title from jobs.public_job`)).toBe('none');
  });

  // Catalogue-wide, so a table any module adds later (assessment, intake) is covered without editing this test.
  // EXECUTE on functions is left to PostgreSQL's default (PUBLIC); the guard there is that no app function is SECURITY
  // DEFINER, checked below. TEMPORARY on the database is PUBLIC's default too and reaches no app data.
  // SAFETY: mutation check: GRANT SELECT ON workspaces.client TO aivera_public -> this test failed (named the table)
  // SAFETY: mutation check: GRANT UPDATE (title) ON jobs.public_job TO aivera_public -> this test failed (named the column)
  it("aivera_public's only privileges are USAGE on jobs and SELECT on public_job's public columns", async () => {
    const reach = await admin.execute<{ what: string }>(sql`
      with public_columns(name) as (values ('slug'), ('title'), ('job_type'), ('descriptor'), ('location'),
        ('pay_min_minor'), ('pay_max_minor'), ('pay_currency'), ('competencies'), ('posted_at'), ('open'), ('paused'))
      select 'table ' || n.nspname || '.' || c.relname as what
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where c.relkind in ('r', 'p', 'v', 'm', 'f') and n.nspname not in ('pg_catalog', 'information_schema')
          and has_table_privilege('aivera_public', c.oid,
            'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN')
      union all
      select 'column ' || n.nspname || '.' || c.relname || '.' || a.attname
        from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
        where c.relkind in ('r', 'p', 'v', 'm', 'f') and n.nspname not in ('pg_catalog', 'information_schema')
          and a.attnum > 0 and not a.attisdropped
          and (has_column_privilege('aivera_public', c.oid, a.attnum, 'INSERT, UPDATE, REFERENCES')
            or (has_column_privilege('aivera_public', c.oid, a.attnum, 'SELECT')
              and not (c.oid = 'jobs.public_job'::regclass and a.attname in (select name from public_columns))))
      union all
      select 'sequence ' || n.nspname || '.' || c.relname
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
        -- CASE: the planner may run the privilege check before the relkind filter, and it errors on a non-sequence.
        where case when c.relkind = 'S' then has_sequence_privilege('aivera_public', c.oid, 'USAGE, SELECT, UPDATE') end
      union all
      select 'schema ' || nspname from pg_namespace
        where nspname not in ('pg_catalog', 'information_schema') and nspname not like 'pg_%'
          and (has_schema_privilege('aivera_public', nspname, 'CREATE')
            or (has_schema_privilege('aivera_public', nspname, 'USAGE') and nspname not in ('jobs', 'public')))
      union all
      select 'database create' where has_database_privilege('aivera_public', current_database(), 'CREATE')
      union all
      select 'member of ' || m.roleid::regrole::text from pg_auth_members m where m.member = 'aivera_public'::regrole
      union all
      select 'security definer ' || p.oid::regprocedure::text
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where p.prosecdef and n.nspname not in ('pg_catalog', 'information_schema') and n.nspname not like 'pg_%'
      order by 1`);
    expect([...reach]).toEqual([]);
    expect(await asPublicRole(sql`select slug from jobs.public_job`)).toBe('none');
  });

  it('the app role, in a workspace, still sees only its own workspace in the read model', async () => {
    const other = await workspaces.withWorkspace({ userId: ALEX }, demo, async ({ tx }) => [
      ...(await tx.execute(sql`select count(*)::int as n from jobs.public_job where workspace_id <> ${demo}`)),
    ]);
    expect(other).toEqual([{ n: 0 }]);
  });
});
