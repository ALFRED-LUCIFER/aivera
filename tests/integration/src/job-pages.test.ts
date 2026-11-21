import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { AuditContract } from '@credalent/audit';
import { createAudit } from '@credalent/audit/composition';
import { createDb, withWorkspace, type Db } from '@credalent/db';
import { JobError, type Competency, type JobsContract } from '@credalent/jobs';
import { createJobs } from '@credalent/jobs/composition';
import { ForbiddenError, type Role, type WorkspaceContext, type WorkspacesContract } from '@credalent/workspaces';
import { createWorkspaces } from '@credalent/workspaces/composition';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// The job pages' reads and the rubric revision (AIV-P1-011 to 013) against real PostgreSQL, as the non-owner aivera_app
// role. Synthetic cast only (docs/00-product/personas.md).

const rolesSql = readFileSync(createRequire(import.meta.url).resolve('@credalent/db/sql/roles.sql'), 'utf8');
const dbCli = join(import.meta.dirname, '..', '..', '..', 'packages', 'db', 'src', 'cli.ts');

const ALEX = '0190d4a2-0000-7000-8000-00000000a1e1'; // admin of every workspace here
const HEAD = '0190d4a2-0000-7000-8000-0000000052bb'; // Head of Engineering, hiring owner of Senior AI Engineer
const LINA = '0190d4a2-0000-7000-8000-0000000052dd'; // interviewer, granted no job
const RANA = '0190d4a2-0000-7000-8000-0000000052aa'; // recruiter
const NOW = new Date('2026-11-12T09:00:00.000Z');

let container: StartedPostgreSqlContainer;
let admin: Db;
let app: Db;
let audit: AuditContract;
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
  audit = createAudit(app, () => NOW);
  workspaces = createWorkspaces(app, audit);
  jobs = createJobs(workspaces, audit, () => NOW);

  demo = await newWorkspace('Demo');
  await addMember(demo, HEAD, 'hiring_owner');
  await addMember(demo, LINA, 'interviewer');
  await addMember(demo, RANA, 'recruiter');
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
      // Assessment's count reaches the jobs header with AIV-P1-099: not yet available, never an invented count.
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

describe('Feature: Job rubric (AIV-P1-012)', () => {
  it('the read model returns the approved version and the full history, newest first, with competencies', async () => {
    const versions = await as(ALEX, demo, (ctx) => jobs.listRubricVersions(ctx, sae));
    expect(versions?.map((v) => [v.version, v.status, v.approvedBy])).toEqual([
      [2, 'approved', HEAD],
      [1, 'superseded', HEAD],
    ]);
    expect(versions?.map((v) => v.competencies.map((c) => c.weightPercent))).toEqual([
      [50, 50],
      [60, 40],
    ]);
  });

  it('Hiring owner can read: the granted hiring owner reads the rubric', async () => {
    expect(await as(HEAD, demo, (ctx) => jobs.listRubricVersions(ctx, sae))).toHaveLength(2);
  });

  // SAFETY: mutation check: listRubricVersions skipped the job lookup (authorised only a found job) -> this test failed
  it('an interviewer not on this job, and another workspace, read nothing', async () => {
    expect(await as(LINA, demo, (ctx) => jobs.listRubricVersions(ctx, sae))).toBeNull();
    expect(await as(ALEX, demo, (ctx) => jobs.listRubricVersions(ctx, elsewhere))).toBeNull();
  });
});

/** Saves Senior AI Engineer's rubric as `userId`, from the copy at `base`. */
const save = (userId: string, base: { versionId: string; revision: number }, weights: number[]) =>
  as(userId, demo, (ctx) =>
    jobs.saveRubric(ctx, sae, { successStatement: 'Ships reliable work.', competencies: competencies(weights), base }),
  );
const versions = async () => (await as(ALEX, demo, (ctx) => jobs.listRubricVersions(ctx, sae))) ?? [];

// The scenarios build on each other in file order: version 3 is drafted, edited, sent, then resumed.
describe('Feature: Edit an approved rubric as a new version (AIV-P1-013)', () => {
  let v2: { versionId: string; revision: number };
  let v3: string;

  // SAFETY: mutation check: editsInPlace true for an approved version -> this file failed (version 2 could not be drafted)
  it('Editing creates a draft version 3 with a change note; version 2 is untouched', async () => {
    const [approved] = await versions();
    v2 = { versionId: approved?.id ?? '', revision: approved?.revision ?? -1 };
    const draft = await save(RANA, v2, [60, 40]);
    v3 = draft.id;
    expect(draft).toMatchObject({
      version: 3,
      status: 'draft',
      revision: 0,
      changeNote: 'Competency 1 raised from 50% to 60%; Competency 2 lowered from 50% to 40%.',
    });
    const [three, two] = await versions();
    expect(three?.competencies.map((c) => c.weightPercent)).toEqual([60, 40]);
    expect(two).toMatchObject({ version: 2, status: 'approved' });
    expect(two?.competencies.map((c) => c.weightPercent)).toEqual([50, 50]);
  });

  // SAFETY: mutation check: removed the base check from saveRubric -> this test failed
  it('Concurrent edit is detected: a save from an older copy is refused and nothing is overwritten', async () => {
    // Opened version 2 before version 3 existed.
    await expect(save(ALEX, v2, [70, 30])).rejects.toMatchObject({ code: 'stale' });
    await save(ALEX, { versionId: v3, revision: 0 }, [55, 45]);
    // A second editor still holding revision 0.
    const stale = save(RANA, { versionId: v3, revision: 0 }, [65, 35]);
    await expect(stale).rejects.toBeInstanceOf(JobError);
    await expect(stale).rejects.toThrow('This rubric changed since you opened it. Reload to see the latest.');
    const [three] = await versions();
    expect(three).toMatchObject({ id: v3, revision: 1 });
    expect(three?.competencies.map((c) => c.weightPercent)).toEqual([55, 45]);
  });

  it('Sending for approval keeps version 2 in force, and the audit log records the submission', async () => {
    await as(RANA, demo, (ctx) => jobs.submitRubric(ctx, v3));
    expect((await versions()).map((v) => [v.version, v.status])).toEqual([
      [3, 'awaiting_approval'],
      [2, 'approved'],
      [1, 'superseded'],
    ]);
    // What assessment and ranking read.
    expect(await as(ALEX, demo, (ctx) => jobs.getApprovedRubric(ctx, sae))).toMatchObject({ version: 2 });
    expect(await audit.listFor(demo, { type: 'rubric_version', id: v3 })).toMatchObject([
      {
        action: 'rubric.saved',
        actor: { type: 'user', id: RANA },
        before: { status: null },
        after: { status: 'draft', version: 3, revision: 0 },
      },
      { action: 'rubric.saved', actor: { type: 'user', id: ALEX }, after: { revision: 1 } },
      {
        action: 'rubric.submitted',
        actor: { type: 'user', id: RANA },
        before: { status: 'draft' },
        after: { status: 'awaiting_approval', jobId: sae, version: 3 },
      },
    ]);
  });

  it('One open draft per job: another recruiter edits version 3, not a new version 4', async () => {
    const edited = await save(ALEX, { versionId: v3, revision: 1 }, [50, 50]);
    expect(edited).toMatchObject({ id: v3, version: 3, status: 'draft', revision: 2 });
    expect(await versions()).toHaveLength(3);
    // Taking it back from awaiting approval to draft is in the audit log.
    expect((await audit.listFor(demo, { type: 'rubric_version', id: v3 })).at(-1)).toMatchObject({
      action: 'rubric.saved',
      before: { status: 'awaiting_approval', revision: 1 },
      after: { status: 'draft', revision: 2 },
    });
  });

  it("an approved version's revision is frozen, as the rest of it", async () => {
    const update = as(ALEX, demo, (ctx) =>
      ctx.tx.execute(sql`update jobs.rubric_version set revision = 9 where id = ${v2.versionId}`),
    );
    await expect(update).rejects.toMatchObject({ constraint: 'rubric_version_frozen_check' });
  });

  it('the database refuses a second open version for the job', async () => {
    const insert = as(ALEX, demo, (ctx) =>
      ctx.tx.execute(sql`insert into jobs.rubric_version
        (id, workspace_id, job_id, version, status, success_statement, created_by, created_at)
        values (gen_random_uuid(), ${demo}, ${sae}, 4, 'draft', 'x', ${ALEX}, now())`),
    );
    await expect(insert).rejects.toMatchObject({ code: '23505', constraint: 'rubric_version_one_open_idx' });
  });

  it('Only recruiters and admins edit: a hiring owner gets 403', async () => {
    await expect(save(HEAD, { versionId: v3, revision: 2 }, [60, 40])).rejects.toBeInstanceOf(ForbiddenError);
    await expect(as(HEAD, demo, (ctx) => jobs.submitRubric(ctx, v3))).rejects.toBeInstanceOf(ForbiddenError);
  });
});
