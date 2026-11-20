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

// AIV-P1-014 acceptance scenarios against real PostgreSQL, as the non-owner aivera_app role (ADR-004, ADR-005): the
// hiring owner approves or returns a rubric version; approval writes RubricApproved.v1 to the jobs outbox in the same
// transaction. Synthetic cast only (docs/00-product/personas.md).

const rolesSql = readFileSync(createRequire(import.meta.url).resolve('@credalent/db/sql/roles.sql'), 'utf8');
const dbCli = join(import.meta.dirname, '..', '..', '..', 'packages', 'db', 'src', 'cli.ts');

const ALEX = '0190d4a2-0000-7000-8000-00000000a1e1'; // admin
const RANA = '0190d4a2-0000-7000-8000-0000000052aa'; // recruiter
const HEAD = '0190d4a2-0000-7000-8000-0000000052bb'; // Head of Engineering, hiring owner of Senior AI Engineer
const DESIGN = '0190d4a2-0000-7000-8000-0000000052ee'; // Design Director, hiring owner, granted SAE but not its owner
const NOW = new Date('2026-11-12T09:00:00.000Z');

let container: StartedPostgreSqlContainer;
let admin: Db;
let app: Db;
let audit: AuditContract;
let workspaces: WorkspacesContract;
let jobs: JobsContract;
let demo: string;
let sae: string;
let spd: string;

const urlFor = (role: string) =>
  `postgres://${role}:local_dev_only@${container.getHost()}:${container.getPort()}/${container.getDatabase()}`;

const as = <T>(userId: string, fn: (ctx: WorkspaceContext) => Promise<T>) =>
  workspaces.withWorkspace({ userId }, demo, fn);

const addMember = (userId: string, role: Role) =>
  withWorkspace(app, demo, (tx) =>
    tx.execute(
      sql`insert into workspaces.member (workspace_id, user_id, role, status) values (${demo}, ${userId}, ${role}, 'active')`,
    ),
  );

const competencies = (weights: number[]): Competency[] =>
  weights.map((weightPercent, i) => ({
    name: `Competency ${i + 1}`,
    evidenceExpected: 'A repository, a document or a reference',
    weightPercent,
    levelNeeded: 3,
    type: 'mandatory',
    origin: 'from_description',
  }));

const sent = async (jobId: string, weights: number[]) => {
  const version = await as(RANA, (ctx) =>
    jobs.saveRubric(ctx, jobId, { successStatement: 'Ships.', competencies: competencies(weights) }),
  );
  return as(RANA, (ctx) => jobs.submitRubric(ctx, version.id));
};

const stageOf = async (jobId: string) =>
  (await admin.execute<{ stage: string }>(sql`select stage from jobs.job where id = ${jobId}`))[0]?.stage;
const versions = (jobId: string) =>
  as(ALEX, async ({ tx }) => [
    ...(await tx.execute<{ version: number; status: string; return_note: string | null }>(
      sql`select version, status, return_note from jobs.rubric_version where job_id = ${jobId} order by version`,
    )),
  ]);

/** RubricApproved.v1 rows in the jobs outbox for the job, read as the migrator (no row-level security on it). */
const approvedEvents = async (jobId: string) => [
  ...(await admin.execute<{ type: string; payload: Record<string, unknown>; workspace_id: string }>(
    sql`select type, payload, workspace_id from jobs.outbox where payload->>'jobId' = ${jobId} order by id`,
  )),
];

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
  demo = (
    await workspaces.createWorkspace({
      name: 'Demo Hiring Co',
      company: 'Demo Hiring Co',
      hiringFocus: 'AI',
      synthetic: true,
      creatorUserId: ALEX,
    })
  ).id;
  await addMember(RANA, 'recruiter');
  await addMember(HEAD, 'hiring_owner');
  await addMember(DESIGN, 'hiring_owner');
  const create = (title: string, hiringOwnerUserId: string) =>
    as(RANA, (ctx) =>
      jobs.createJob(ctx, {
        title,
        jobType: 'ai_llm_engineering',
        description: `${title}, synthetic demo job.`,
        hiringOwnerUserId,
        synthetic: true,
      }),
    );
  sae = (await create('Senior AI Engineer', HEAD)).id;
  spd = (await create('Senior Product Designer', DESIGN)).id;
  await as(ALEX, (ctx) => workspaces.grantJobAccess(ctx, { userId: DESIGN, jobId: sae }));
});

afterAll(async () => {
  await app?.$client.end();
  await admin?.$client.end();
  await container?.stop();
});

describe('Scenario: Approve', () => {
  it('version 2 approved by the Head of Engineering supersedes version 1 and writes RubricApproved.v1, audited', async () => {
    const v1 = await sent(sae, [60, 40]);
    await as(HEAD, (ctx) => jobs.approveRubric(ctx, v1.id, v1.revision));
    const v2 = await sent(sae, [50, 50]);

    await as(HEAD, (ctx) => jobs.approveRubric(ctx, v2.id, v2.revision));

    expect(await versions(sae)).toMatchObject([
      { version: 1, status: 'superseded' },
      { version: 2, status: 'approved' },
    ]);
    expect(await approvedEvents(sae)).toEqual([
      expect.objectContaining({ type: 'RubricApproved.v1', workspace_id: demo }),
      {
        type: 'RubricApproved.v1',
        workspace_id: demo,
        payload: { jobId: sae, rubricVersionId: v2.id, supersededVersionId: v1.id },
      },
    ]);
    const [, , approved] = await audit.listFor(demo, { type: 'rubric_version', id: v2.id });
    expect(approved).toMatchObject({
      action: 'rubric.approved',
      actor: { type: 'user', id: HEAD },
      after: { status: 'approved', version: 2, actingAs: 'owner' },
    });
  });

  it('the approval and its event commit together: an approval that rolls back leaves no event', async () => {
    const v3 = await sent(sae, [40, 60]);
    await expect(
      as(HEAD, async (ctx) => {
        await jobs.approveRubric(ctx, v3.id, v3.revision);
        throw new Error('rolled back after the approval');
      }),
    ).rejects.toThrow('rolled back');
    expect(await approvedEvents(sae)).toHaveLength(2);
    expect((await versions(sae)).at(-1)).toMatchObject({ version: 3, status: 'awaiting_approval' });
  });

  it('an admin may approve as the owner, and is recorded as acting for them', async () => {
    const [v3] = (await as(ALEX, (ctx) => jobs.listRubricVersions(ctx, sae))) ?? [];
    await as(ALEX, (ctx) => jobs.approveRubric(ctx, v3?.id ?? ''));
    const entries = await audit.listFor(demo, { type: 'rubric_version', id: v3?.id ?? '' });
    expect(entries.at(-1)).toMatchObject({ actor: { id: ALEX }, after: { actingAs: 'admin_as_owner' } });
  });
});

describe('Scenario: Return with a note', () => {
  it('"Arabic NLP should be desirable": returned with the note, audited, the approved version stays in force', async () => {
    const v4 = await sent(sae, [30, 70]);
    await as(HEAD, (ctx) => jobs.returnRubric(ctx, v4.id, ' Arabic NLP should be desirable ', v4.revision));
    expect((await versions(sae)).slice(-2)).toEqual([
      { version: 3, status: 'approved', return_note: null },
      { version: 4, status: 'returned', return_note: 'Arabic NLP should be desirable' },
    ]);
    expect((await as(RANA, (ctx) => jobs.getApprovedRubric(ctx, sae)))?.version).toBe(3);
    const entries = await audit.listFor(demo, { type: 'rubric_version', id: v4.id });
    expect(entries.at(-1)).toMatchObject({
      action: 'rubric.returned',
      actor: { id: HEAD },
      after: { status: 'returned', note: 'Arabic NLP should be desirable', actingAs: 'owner' },
    });
    // Sent again, the note is cleared and the sender recorded.
    await as(RANA, (ctx) => jobs.submitRubric(ctx, v4.id));
    expect((await versions(sae)).at(-1)).toMatchObject({ status: 'awaiting_approval', return_note: null });
  });

  it('a return needs a note', async () => {
    const [v4] = (await as(ALEX, (ctx) => jobs.listRubricVersions(ctx, sae))) ?? [];
    await expect(as(HEAD, (ctx) => jobs.returnRubric(ctx, v4?.id ?? '', '  '))).rejects.toThrow(
      new JobError('return_note'),
    );
  });
});

describe('Scenario: Only the hiring owner approves', () => {
  it('a recruiter, and a hiring owner granted the job who is not its owner, get 403 and the version is unchanged', async () => {
    const [v4] = (await as(ALEX, (ctx) => jobs.listRubricVersions(ctx, sae))) ?? [];
    for (const user of [RANA, DESIGN]) {
      await expect(as(user, (ctx) => jobs.approveRubric(ctx, v4?.id ?? ''))).rejects.toThrow(ForbiddenError);
      await expect(as(user, (ctx) => jobs.returnRubric(ctx, v4?.id ?? '', 'No'))).rejects.toThrow(ForbiddenError);
    }
    expect((await versions(sae)).at(-1)).toMatchObject({ version: 4, status: 'awaiting_approval' });
  });
});

describe('Scenario: Approving an outdated version is refused', () => {
  it('a decision on an older copy of the version is refused as stale and changes nothing', async () => {
    const [v4] = (await as(ALEX, (ctx) => jobs.listRubricVersions(ctx, sae))) ?? [];
    const read = v4?.revision ?? 0;
    // The recruiter edits it after the email went out: back to draft, then sent again with a new revision.
    await sent(sae, [20, 80]);
    await expect(as(HEAD, (ctx) => jobs.approveRubric(ctx, v4?.id ?? '', read))).rejects.toThrow(new JobError('stale'));
    expect((await versions(sae)).at(-1)).toMatchObject({ version: 4, status: 'awaiting_approval' });
  });
});

describe('Scenario: Nothing is assessed before approval', () => {
  // SAFETY: mutation check: removed assertTransition from approveRubric's decision guard -> this test failed (a draft
  // was approved and RubricApproved.v1 written)
  it('Senior Product Designer has never had an approved rubric: no RubricApproved.v1, and a draft cannot be approved', async () => {
    const draft = await as(RANA, (ctx) =>
      jobs.saveRubric(ctx, spd, { successStatement: 'Designs.', competencies: competencies([100]) }),
    );
    await expect(as(DESIGN, (ctx) => jobs.approveRubric(ctx, draft.id))).rejects.toThrow(
      new JobError('version_status'),
    );
    expect(await approvedEvents(spd)).toEqual([]);
    expect(await as(RANA, (ctx) => jobs.getApprovedRubric(ctx, spd))).toBeNull();
    expect((await as(RANA, (ctx) => jobs.getJobHeader(ctx, spd)))?.assessed).toBe(0);
  });
});

describe("My desk: the recruiter's rubric approvals", () => {
  it('lists the version awaiting approval and the one approved this week as done', async () => {
    const items = await as(RANA, (ctx) => jobs.listRubricApprovals(ctx));
    expect(items.map((i) => [i.title, i.version, i.status])).toEqual([
      ['Senior AI Engineer', 3, 'approved'],
      ['Senior AI Engineer', 4, 'awaiting_approval'],
    ]);
  });
});

// AIV-P1-067: the stage change the demo seed moves its jobs with.
describe('Moving a job between stages', () => {
  // SAFETY: mutation check: removed the approvedVersion check from changeStage -> this test failed (the job moved)
  it('a job with no approved rubric stays at "defining rubric"', async () => {
    await expect(as(RANA, (ctx) => jobs.changeStage(ctx, spd, 'collecting_evidence'))).rejects.toThrow(
      new JobError('stage_needs_rubric'),
    );
    expect(await stageOf(spd)).toBe('defining_rubric');
  });

  it('a hiring owner may not move a job; a recruiter moves it once, audited with the stage before and after', async () => {
    await expect(as(HEAD, (ctx) => jobs.changeStage(ctx, sae, 'round_1'))).rejects.toThrow(ForbiddenError);
    await as(RANA, (ctx) => jobs.changeStage(ctx, sae, 'round_1'));
    await as(RANA, (ctx) => jobs.changeStage(ctx, sae, 'round_1'));
    expect(await stageOf(sae)).toBe('round_1');
    const moves = (await audit.listFor(demo, { type: 'job', id: sae })).filter((e) => e.action === 'job.stage_changed');
    expect(moves).toEqual([
      expect.objectContaining({
        actor: { type: 'user', id: RANA },
        before: { stage: 'defining_rubric' },
        after: { stage: 'round_1' },
      }),
    ]);
  });
});
