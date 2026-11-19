import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { createAudit } from '@aivera/audit/composition';
import { createDb, withWorkspace, type Db } from '@aivera/db';
import type { Competency, JobsContract } from '@aivera/jobs';
import { createJobs } from '@aivera/jobs/composition';
import type { Role, WorkspaceContext, WorkspacesContract } from '@aivera/workspaces';
import { createWorkspaces } from '@aivera/workspaces/composition';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// The job pages' reads and the rubric revision (AIV-P1-011 to 013) against real PostgreSQL, as the non-owner aivera_app
// role. Synthetic cast only (docs/00-product/personas.md).

const rolesSql = readFileSync(createRequire(import.meta.url).resolve('@aivera/db/sql/roles.sql'), 'utf8');
const dbCli = join(import.meta.dirname, '..', '..', '..', 'packages', 'db', 'src', 'cli.ts');

const ALEX = '0190d4a2-0000-7000-8000-00000000a1e1'; // admin of every workspace here
const HEAD = '0190d4a2-0000-7000-8000-0000000052bb'; // Head of Engineering, hiring owner of Senior AI Engineer
const LINA = '0190d4a2-0000-7000-8000-0000000052dd'; // interviewer, granted no job
const NOW = new Date('2026-11-12T09:00:00.000Z');

let container: StartedPostgreSqlContainer;
let admin: Db;
let app: Db;
let workspaces: WorkspacesContract;
let jobs: JobsContract;
let demo: string;
let other: string;
let sae: string;
let spd: string;
let elsewhere: string;

const urlFor = (role: string) =>
  `postgres://${role}:local_dev_only@${container.getHost()}:${container.getPort()}/${container.getDatabase()}`;

const as = <T>(userId: string, workspaceId: string, fn: (ctx: WorkspaceContext) => Promise<T>) =>
  workspaces.withWorkspace({ userId }, workspaceId, fn);

const newWorkspace = async (name: string) =>
  (await workspaces.createWorkspace({ name, company: name, hiringFocus: 'AI', synthetic: true, creatorUserId: ALEX }))
    .id;

const addMember = (workspaceId: string, userId: string, role: Role) =>
  withWorkspace(app, workspaceId, (tx) =>
    tx.execute(
      sql`insert into workspaces.member (workspace_id, user_id, role, status) values (${workspaceId}, ${userId}, ${role}, 'active')`,
    ),
  );

const competencies = (weights: number[]): Competency[] =>
  weights.map((weightPercent, i) => ({
    name: `Competency ${i + 1}`,
    evidenceExpected: 'A repository, a document or a reference',
    weightPercent,
    levelNeeded: 4,
    type: 'mandatory',
    origin: 'from_description',
  }));

const newJob = (workspaceId: string, title: string, hiringOwnerUserId: string | null = null) =>
  as(ALEX, workspaceId, (ctx) =>
    jobs.createJob(ctx, {
      title,
      jobType: 'ai_llm_engineering',
      team: 'Engineering',
      location: 'DIFC, Dubai',
      hiringOwnerUserId,
      description: `${title}, synthetic demo job.`,
      synthetic: true,
    }),
  );

/** Saves a version, sends it and has the Head of Engineering approve it. */
const approvedVersion = async (jobId: string, weights: number[]) => {
  const version = await as(ALEX, demo, (ctx) =>
    jobs.saveRubric(ctx, jobId, { successStatement: 'Ships reliable work.', competencies: competencies(weights) }),
  );
  await as(ALEX, demo, (ctx) => jobs.submitRubric(ctx, version.id));
  await as(HEAD, demo, (ctx) => jobs.approveRubric(ctx, version.id));
  return version;
};

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

  demo = await newWorkspace('Demo');
  await addMember(demo, HEAD, 'hiring_owner');
  await addMember(demo, LINA, 'interviewer');
  sae = (await newJob(demo, 'Senior AI Engineer', HEAD)).id;
  await as(ALEX, demo, (ctx) => workspaces.grantJobAccess(ctx, { userId: HEAD, jobId: sae }));
  await approvedVersion(sae, [60, 40]);
  await approvedVersion(sae, [50, 50]);
  spd = (await newJob(demo, 'Senior Product Designer')).id;
  await as(ALEX, demo, (ctx) =>
    jobs.saveRubric(ctx, spd, { successStatement: 'Ships designs.', competencies: competencies([100]) }),
  );
  other = await newWorkspace('Gulf Talent Partners');
  elsewhere = (await newJob(other, 'Data Engineer')).id;
});

afterAll(async () => {
  await app?.$client.end();
  await admin?.$client.end();
  await container?.stop();
});

describe('Feature: Job header with its five stages (AIV-P1-011)', () => {
  it('Senior AI Engineer: version 2 approved and in force, version 1 superseded', async () => {
    const header = await as(ALEX, demo, (ctx) => jobs.getJobHeader(ctx, sae));
    expect(header).toMatchObject({
      job: { title: 'Senior AI Engineer', team: 'Engineering', location: 'DIFC, Dubai', hiringOwnerUserId: HEAD },
      approved: { version: 2, status: 'approved' },
      latest: { version: 2, status: 'approved' },
      // Assessment (AIV-P1-031) does not report yet: not yet available, never an invented count.
      assessed: null,
    });
  });

  it('A job waiting for approval: a draft, nothing assessed', async () => {
    const header = await as(ALEX, demo, (ctx) => jobs.getJobHeader(ctx, spd));
    expect(header).toMatchObject({ approved: null, latest: { version: 1, status: 'draft' }, assessed: 0 });
  });

  it('the granted hiring owner reads the header', async () => {
    expect((await as(HEAD, demo, (ctx) => jobs.getJobHeader(ctx, sae)))?.job.id).toBe(sae);
  });

  it("Unknown or other-workspace job: another workspace's job and an ungranted job are null", async () => {
    expect(await as(ALEX, demo, (ctx) => jobs.getJobHeader(ctx, elsewhere))).toBeNull();
    expect(await as(ALEX, demo, (ctx) => jobs.getJobHeader(ctx, '0190d4a2-0000-7000-8000-000000000000'))).toBeNull();
    expect(await as(LINA, demo, (ctx) => jobs.getJobHeader(ctx, sae))).toBeNull();
    expect(await as(HEAD, demo, (ctx) => jobs.getJobHeader(ctx, spd))).toBeNull();
  });
});
