import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { AssessmentContract } from '@credalent/assessment';
import { createAssessment, createAssessmentHandlers } from '@credalent/assessment/composition';
import type { AuditContract } from '@credalent/audit';
import { createAudit } from '@credalent/audit/composition';
import { createDb, newEnvelope, uuidv7, withWorkspace, type Db, type Envelope } from '@credalent/db';
import { createConsumer, type Delivery } from '@credalent/db/consumer';
import {
  ContradictionResolvedV1,
  EvidenceMappedV1,
  EvidenceRecordedV1,
  type EvidenceContract,
} from '@credalent/evidence';
import { createEvidence, readEvidenceForJobAsSystem } from '@credalent/evidence/composition';
import { RubricApprovedV1, type Competency, type JobsContract } from '@credalent/jobs';
import { createApprovedRubricReads, createJobs } from '@credalent/jobs/composition';
import { ForbiddenError, type Role, type WorkspaceContext, type WorkspacesContract } from '@credalent/workspaces';
import { createWorkspaces } from '@credalent/workspaces/composition';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// AIV-P1-031 acceptance scenarios: the `assessment` queue's consumer against real PostgreSQL as aivera_app, with a fake
// Service Bus delivery (the in-memory bus of worker.test.ts) and the real jobs and evidence reads. Who applied to what
// is the intake module's worker read, stubbed here (intake's own tests cover it). Synthetic cast only
// (docs/00-product/personas.md).

const rolesSql = readFileSync(createRequire(import.meta.url).resolve('@credalent/db/sql/roles.sql'), 'utf8');
const dbCli = join(import.meta.dirname, '..', '..', '..', 'packages', 'db', 'src', 'cli.ts');

const ALEX = '0190d4a2-0000-7000-8000-00000000a1e1'; // admin of both workspaces
const RANA = '0190d4a2-0000-7000-8000-0000000052aa'; // recruiter
const HEAD = '0190d4a2-0000-7000-8000-0000000052bb'; // Head of Engineering, hiring owner of Senior AI Engineer
const DESIGN = '0190d4a2-0000-7000-8000-0000000052ee'; // Design Director, hiring owner of Senior Product Designer only
const LINA = '0190d4a2-0000-7000-8000-0000000011aa'; // interviewer, granted Senior AI Engineer
// Opaque person ids of the candidates module.
const SARA = '0190d4a2-0000-7000-8000-00000000c001';
const DANIEL = '0190d4a2-0000-7000-8000-00000000c002';
const MARIA = '0190d4a2-0000-7000-8000-00000000c003';
const OMAR = '0190d4a2-0000-7000-8000-00000000c004';
const NOW = new Date('2026-11-20T09:00:00.000Z');

let container: StartedPostgreSqlContainer;
let admin: Db;
let app: Db;
let audit: AuditContract;
let workspaces: WorkspacesContract;
let jobs: JobsContract;
let evidence: EvidenceContract;
let assessment: AssessmentContract;
let consumer: ReturnType<typeof createConsumer>;
let w1: string;
let w2: string;
let sae: string; // Senior AI Engineer, W1
let spd: string; // Senior Product Designer, W1
let gulf: string; // Senior AI Engineer at Gulf Talent Partners, W2
const versions: Record<string, string> = {};
const applications = new Map<string, string[]>();

const urlFor = (role: string) =>
  `postgres://${role}:local_dev_only@${container.getHost()}:${container.getPort()}/${container.getDatabase()}`;

const as = <T>(userId: string, workspaceId: string, fn: (ctx: WorkspaceContext) => Promise<T>) =>
  workspaces.withWorkspace({ userId }, workspaceId, fn);

const addMember = (userId: string, role: Role) =>
  withWorkspace(app, w1, (tx) =>
    tx.execute(
      sql`insert into workspaces.member (workspace_id, user_id, role, status) values (${w1}, ${userId}, ${role}, 'active')`,
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

/** Saves the job's next rubric version and sends it for approval. */
const sent = async (workspaceId: string, jobId: string, weights: number[]) => {
  const version = await as(ALEX, workspaceId, (ctx) =>
    jobs.saveRubric(ctx, jobId, { successStatement: 'Ships.', competencies: competencies(weights) }),
  );
  return as(ALEX, workspaceId, (ctx) => jobs.submitRubric(ctx, version.id));
};
const approve = (workspaceId: string, version: { id: string; revision: number }) =>
  as(ALEX, workspaceId, (ctx) => jobs.approveRubric(ctx, version.id, version.revision));

/** The version's competency ids in position order, read as the migrator. */
const competencyIds = async (versionId: string) =>
  (
    await admin.execute<{ id: string }>(
      sql`select id from jobs.competency where rubric_version_id = ${versionId} order by position`,
    )
  ).map((r) => r.id);

/** Strong, corroborated real work for the candidate at `level` on one competency of the job. */
const work = (workspaceId: string, candidateId: string, jobId: string, competencyId: string, level: number) =>
  as(ALEX, workspaceId, (ctx) =>
    evidence.recordEvidence(ctx, {
      candidateId,
      source: {
        kind: 'repository',
        label: 'llm-eval-harness',
        url: 'https://code.credalent.example/llm-eval-harness',
        blobFileId: null,
        capturedAt: NOW,
        checkedAt: NOW,
        checkMethod: 'Commit history',
      },
      items: [
        {
          excerpt: 'authored 412 of 460 commits',
          excerptSpan: null,
          provenance: 'corroborated',
          strength: 'strong',
          limit: 'Shows the tooling, not how results changed product decisions.',
          competencies: [{ jobId, competencyId, level }],
        },
      ],
      synthetic: true,
    }),
  );

const mapped = (workspaceId: string, candidateId: string, jobId: string, rubricVersionId: string) =>
  newEnvelope(EvidenceMappedV1, {
    workspaceId,
    payload: { candidateId, jobId, rubricVersionId, mappingId: uuidv7() },
    occurredAt: NOW,
  });

const resolved = (workspaceId: string, candidateId: string, jobId: string, rubricVersionId: string) =>
  newEnvelope(ContradictionResolvedV1, {
    workspaceId,
    payload: { candidateId, jobId, rubricVersionId, comparisonId: uuidv7() },
    occurredAt: NOW,
  });

/** Delivers the envelope through the queue's consumer, as Service Bus would, and returns how it was settled. */
const deliver = async (envelope: Envelope) => {
  const settled: string[] = [];
  const delivery: Delivery = {
    body: envelope,
    deliveryCount: 1,
    complete: async () => void settled.push('complete'),
    abandon: async () => void settled.push('abandon'),
    deadLetter: async (reason) => void settled.push(`deadLetter: ${reason}`),
  };
  await consumer.handle(delivery);
  return settled;
};

/** Stored results of the job, oldest first, read as the migrator (no row-level security). */
const results = async (jobId: string) => [
  ...(await admin.execute<{ candidate_id: string; rubric_version_id: string; backed_score: number }>(
    sql`select candidate_id, rubric_version_id, backed_score from assessment.result where job_id = ${jobId}
      order by assessed_at, id`,
  )),
];

/** The ranking's read of a job's results with its workspace filter removed: row-level security alone. */
const resultsUnderRls = (workspaceId: string, jobId: string) =>
  withWorkspace(app, workspaceId, async (tx) => [
    ...(await tx.execute<{ candidate_id: string }>(
      sql`select candidate_id from assessment.result where job_id = ${jobId} order by assessed_at, id`,
    )),
  ]);

/** Waits, up to 10 s, until `done` holds. */
const until = async (done: () => boolean | Promise<boolean>) => {
  for (let i = 0; i < 200 && !(await done()); i++) await new Promise((resolve) => setTimeout(resolve, 50));
};

/** Sessions waiting on an advisory lock, seen by the migrator. */
const advisoryWaits = async () =>
  (
    await admin.execute<{ n: number }>(
      sql`select count(*)::int as n from pg_locks where locktype = 'advisory' and not granted`,
    )
  )[0]?.n ?? 0;

const ranking = (userId: string, workspaceId: string, jobId: string) =>
  as(userId, workspaceId, (ctx) => assessment.listRanking(ctx, jobId));

const ranks = async (jobId: string) => {
  const r = await ranking(RANA, w1, jobId);
  if (r.status !== 'ranked') throw new Error(`job not ranked: ${r.status}`);
  return {
    rubricVersionId: r.rubricVersionId,
    rows: r.rows.map((row) => [row.rank, row.candidateId, row.backedScore]),
  };
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
  evidence = createEvidence(workspaces, audit, () => NOW);
  assessment = createAssessment(workspaces, audit, jobs, () => NOW);
  consumer = createConsumer({
    db: app,
    queue: 'assessment',
    handlers: createAssessmentHandlers({
      audit,
      ...createApprovedRubricReads(),
      evidenceForJob: readEvidenceForJobAsSystem,
      applications: {
        jobsForCandidate: async (_tx, _w, candidateId) => applications.get(candidateId) ?? [],
        candidatesForJob: async (_tx, _w, jobId) =>
          [...applications].filter(([, j]) => j.includes(jobId)).map(([c]) => c),
      },
      now: () => NOW,
    }),
    now: () => NOW,
  });

  const newWorkspace = async (name: string) =>
    (await workspaces.createWorkspace({ name, company: name, hiringFocus: 'AI', synthetic: true, creatorUserId: ALEX }))
      .id;
  w1 = await newWorkspace('Demo hiring team');
  w2 = await newWorkspace('Gulf Talent Partners');
  await addMember(RANA, 'recruiter');
  await addMember(HEAD, 'hiring_owner');
  await addMember(DESIGN, 'hiring_owner');
  await addMember(LINA, 'interviewer');
  const create = (workspaceId: string, title: string, hiringOwnerUserId?: string) =>
    as(
      ALEX,
      workspaceId,
      async (ctx) =>
        (
          await jobs.createJob(ctx, {
            title,
            jobType: 'ai_llm_engineering',
            description: `${title}, synthetic demo job.`,
            ...(hiringOwnerUserId && { hiringOwnerUserId }),
            synthetic: true,
          })
        ).id,
    );
  sae = await create(w1, 'Senior AI Engineer', HEAD);
  spd = await create(w1, 'Senior Product Designer', DESIGN);
  gulf = await create(w2, 'Senior AI Engineer');
  await as(ALEX, w1, (ctx) => workspaces.grantJobAccess(ctx, { userId: LINA, jobId: sae }));
  applications.set(SARA, [sae, spd]);
  applications.set(DANIEL, [sae]);
  applications.set(MARIA, [gulf]);

  // Senior AI Engineer: version 1 approved, then version 2 approved (in force). Product Designer: a draft sent only.
  await approve(w1, await sent(w1, sae, [60, 40]));
  const v2 = await sent(w1, sae, [50, 50]);
  await approve(w1, v2);
  versions['sae2'] = v2.id;
  versions['spd1'] = (await sent(w1, spd, [50, 50])).id;
  const gulf1 = await sent(w2, gulf, [100]);
  await approve(w2, gulf1);
  versions['gulf1'] = gulf1.id;
});

afterAll(async () => {
  await app?.$client.end();
  await admin?.$client.end();
  await container?.stop();
});

describe('Scenario: No assessment without an approved rubric', () => {
  it('mapped evidence on a job whose rubric is only a draft stores nothing; the ranking awaits approval', async () => {
    const [designCompetency] = await competencyIds(versions['spd1'] as string);
    await work(w1, SARA, spd, designCompetency as string, 4);

    expect(await deliver(mapped(w1, SARA, spd, versions['spd1'] as string))).toEqual(['complete']);

    // SAFETY: mutation check: jobs readApproved took the latest version instead of status 'approved' -> this test failed (a result on the draft)
    expect(await results(spd)).toEqual([]);
    expect(await ranking(RANA, w1, spd)).toEqual({ status: 'awaiting_rubric' });
  });
});

describe('Scenario: New evidence updates the ranking', () => {
  it('a mapping stores a result on rubric version 2, audited as the system, and the ranking orders by backed score', async () => {
    const [first] = await competencyIds(versions['sae2'] as string);
    await work(w1, SARA, sae, first as string, 5);
    await work(w1, DANIEL, sae, first as string, 3);

    expect(await deliver(mapped(w1, SARA, sae, versions['sae2'] as string))).toEqual(['complete']);
    expect(await ranks(sae)).toEqual({ rubricVersionId: versions['sae2'], rows: [[1, SARA, 50]] });

    await deliver(mapped(w1, DANIEL, sae, versions['sae2'] as string));
    expect(await ranks(sae)).toEqual({
      rubricVersionId: versions['sae2'],
      rows: [
        [1, SARA, 50],
        [2, DANIEL, 30],
      ],
    });
    expect(await results(sae)).toEqual([
      { candidate_id: SARA, rubric_version_id: versions['sae2'], backed_score: 50 },
      { candidate_id: DANIEL, rubric_version_id: versions['sae2'], backed_score: 30 },
    ]);
    const [entry] = await audit.listFor(w1, { type: 'candidate', id: SARA });
    expect([entry?.action, entry?.actor]).toEqual(['score.changed', { type: 'system' }]);
  });
});

describe('Scenario: Duplicate messages do not duplicate snapshots', () => {
  it('the same evidence.mapped message delivered twice stores exactly one result', async () => {
    const [, second] = await competencyIds(versions['sae2'] as string);
    await work(w1, DANIEL, sae, second as string, 4);
    const message = mapped(w1, DANIEL, sae, versions['sae2'] as string);

    expect(await deliver(message)).toEqual(['complete']);
    // More work lands before the redelivery, so only the inbox, not "unchanged writes nothing", can stop a third result.
    const [first] = await competencyIds(versions['sae2'] as string);
    await work(w1, DANIEL, sae, first as string, 5);
    expect(await deliver(message)).toEqual(['complete']);

    // SAFETY: mutation check: createConsumer ran the handler on a duplicate (inbox conflict check removed) -> this test failed (3 results)
    expect((await results(sae)).filter((r) => r.candidate_id === DANIEL)).toHaveLength(2);
    expect((await ranks(sae)).rows).toEqual([
      [1, DANIEL, 70],
      [2, SARA, 50],
    ]);
  });
});

describe('Scenario: Unchanged result writes nothing', () => {
  it('a re-assessment with the same numbers stores no result and no audit entry', async () => {
    const before = [(await results(sae)).length, (await audit.listFor(w1, { type: 'candidate', id: SARA })).length];

    expect(await deliver(mapped(w1, SARA, sae, versions['sae2'] as string))).toEqual(['complete']);

    expect([(await results(sae)).length, (await audit.listFor(w1, { type: 'candidate', id: SARA })).length]).toEqual(
      before,
    );
  });
});

describe('Scenario: An edited rubric does not change rankings until approved', () => {
  it('version 3 sent for approval leaves version 2 in force; approving it re-assesses every candidate on the job', async () => {
    const v3 = await sent(w1, sae, [70, 30]);
    versions['sae3'] = v3.id;
    const [v3First] = await competencyIds(v3.id);
    // Sara's work, mapped to version 3's competency as a mapping run would: it counts only once version 3 is in force.
    await work(w1, SARA, sae, v3First as string, 5);

    // Without evidence mapping, new evidence reaches the assessment queue directly.
    const recorded = newEnvelope(EvidenceRecordedV1, {
      workspaceId: w1,
      payload: { candidateId: SARA, sourceId: uuidv7(), itemIds: [] },
      occurredAt: NOW,
    });
    expect(await deliver(recorded)).toEqual(['complete']);
    // SAFETY: mutation check: jobs readApproved took the latest version instead of status 'approved' -> this test failed (Sara stored on version 3)
    expect(new Set((await results(sae)).map((r) => r.rubric_version_id))).toEqual(new Set([versions['sae2']]));
    expect((await ranks(sae)).rubricVersionId).toBe(versions['sae2']);

    await approve(w1, v3);
    const approved = newEnvelope(RubricApprovedV1, {
      workspaceId: w1,
      payload: { jobId: sae, rubricVersionId: v3.id, supersededVersionId: versions['sae2'] as string },
      occurredAt: NOW,
    });
    expect(await deliver(approved)).toEqual(['complete']);

    // Daniel has nothing mapped to version 3 yet: he scores 0 and stays visible, a gap to close, never a rejection.
    expect(await ranks(sae)).toEqual({
      rubricVersionId: v3.id,
      rows: [
        [1, SARA, 70],
        [2, DANIEL, 0],
      ],
    });

    // A mapping made against version 2 that arrives after version 3's approval is skipped: version 3's mapping follows.
    // SAFETY: mutation check: assessForJob without the stale-version skip (`mappedVersionId !== approved.id`) -> this test failed (a sixth result, scored on version 3 from the version 2 mapping)
    const stored = (await results(sae)).length;
    await work(w1, DANIEL, sae, v3First as string, 2);
    expect(await deliver(mapped(w1, DANIEL, sae, versions['sae2'] as string))).toEqual(['complete']);
    expect(await results(sae)).toHaveLength(stored);
  });
});

describe('Scenario: Workspace isolation in the worker', () => {
  it("each message runs in its own workspace's transaction; a message cannot reach another workspace's job", async () => {
    const [gulfCompetency] = await competencyIds(versions['gulf1'] as string);
    await work(w2, MARIA, gulf, gulfCompetency as string, 3);

    await deliver(mapped(w2, MARIA, gulf, versions['gulf1'] as string));
    // W2's message naming W1's job finds no approved rubric under W2's row-level security, so it stores nothing.
    const stored = (await results(sae)).length;
    await deliver(mapped(w2, SARA, sae, versions['sae2'] as string));

    expect(await results(sae)).toHaveLength(stored);
    expect(await ranking(ALEX, w2, gulf)).toMatchObject({ status: 'ranked', rows: [{ rank: 1, candidateId: MARIA }] });
    const [row] = await admin.execute<{ workspace_id: string }>(
      sql`select workspace_id from assessment.result where job_id = ${gulf}`,
    );
    expect(row?.workspace_id).toBe(w2);
  });

  // SAFETY: mutation check: ALTER POLICY result_tenant_isolation USING (true) WITH CHECK (true) -> this test failed (W2 read W1's results)
  it("the ranking's read with its workspace filter removed still returns none of W1's results to W2", async () => {
    expect(await resultsUnderRls(w2, sae)).toEqual([]);
    expect((await resultsUnderRls(w1, sae)).length).toBeGreaterThan(0);
  });
});

describe('Who sees the ranking', () => {
  it("the job's hiring owner and a granted interviewer see it; a hiring owner without a grant on the job is refused", async () => {
    expect(await ranking(HEAD, w1, sae)).toMatchObject({ status: 'ranked' });
    expect(await ranking(LINA, w1, sae)).toMatchObject({ status: 'ranked' });
    // Removing only the `authorize` call is not caught here: the jobs module's own job.view gate already hides the job.
    // SAFETY: mutation check: replaced `if (!job) throw` and the authorize call with `if (!job?.approvedVersionId) return { status: 'awaiting_rubric' }` -> this test failed (resolved awaiting_rubric)
    await expect(ranking(DESIGN, w1, sae)).rejects.toBeInstanceOf(ForbiddenError);
    expect(await ranking(DESIGN, w1, spd)).toEqual({ status: 'awaiting_rubric' });
  });

  it('the assessed count equals the ranked rows, is 0 before approval, and refuses a job the caller cannot see (AIV-P1-099)', async () => {
    const count = (userId: string, jobIds: string[]) => as(userId, w1, (ctx) => assessment.countAssessed(ctx, jobIds));
    const ranked = await ranking(RANA, w1, sae);
    const rows = ranked.status === 'ranked' ? ranked.rows.length : -1;
    expect(rows).toBeGreaterThan(0);
    expect(await count(RANA, [sae, spd])).toEqual({ [sae]: rows, [spd]: 0 });
    expect(await count(HEAD, [sae])).toEqual({ [sae]: rows });
    // SAFETY: mutation check: dropped the `if (!job) throw new ForbiddenError()` and authorize in countAssessed -> this test failed
    await expect(count(DESIGN, [sae])).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe('Concurrent runs for one candidate and job', () => {
  it('a run that read older evidence never stores after a run that read newer evidence', async () => {
    const v3 = versions['sae3'] as string;
    const [v3First] = await competencyIds(v3);
    await work(w1, OMAR, sae, v3First as string, 2);

    // The first run pauses after reading the evidence until the second has run as far as it can.
    const { promise: paused, resolve: release } = Promise.withResolvers<void>();
    let calls = 0;
    // A clock that moves on each call, so the stored order is the order of storing, not of ids minted in one millisecond.
    let tick = 0;
    const later = () => new Date(NOW.getTime() + ++tick);
    const gated = createConsumer({
      db: app,
      queue: 'assessment',
      handlers: createAssessmentHandlers({
        audit,
        ...createApprovedRubricReads(),
        evidenceForJob: async (...args) => {
          const read = await readEvidenceForJobAsSystem(...args);
          if (calls++ === 0) await paused;
          return read;
        },
        applications: { jobsForCandidate: async () => [], candidatesForJob: async () => [] },
        now: later,
      }),
      now: later,
    });
    const run = (envelope: Envelope) =>
      gated.handle({
        body: envelope,
        deliveryCount: 1,
        complete: async () => {},
        abandon: async () => {},
        deadLetter: async () => {},
      });

    const older = run(mapped(w1, OMAR, sae, v3));
    await until(() => calls === 1);
    await work(w1, OMAR, sae, v3First as string, 5);
    let newerDone = false;
    const newer = run(mapped(w1, OMAR, sae, v3)).then(() => void (newerDone = true));
    // The newer run either finishes (no lock) or waits on the older run's advisory lock.
    await until(async () => newerDone || (await advisoryWaits()) > 0);
    release();
    await Promise.all([older, newer]);

    // SAFETY: mutation check: AssessmentStore.lock made a no-op, and separately the lock moved back after the evidence read -> this test failed (stored [70, 28]: the older read last)
    const omar = (await results(sae)).filter((r) => r.candidate_id === OMAR);
    expect(omar.map((r) => r.backed_score)).toEqual([28, 70]);
  });
});

// Last, so the evidence it adds changes no earlier scenario's numbers.
describe('Scenario: Resolving a contradiction re-scores the candidate (AIV-P1-098)', () => {
  it("a ContradictionResolved message scores that candidate on the event's version, stores the change once, and skips a stale version", async () => {
    const v3 = versions['sae3'] as string;
    const [first] = await competencyIds(v3);
    // Evidence a contradiction had withheld now counts.
    await work(w1, DANIEL, sae, first as string, 5);
    const all = async () => (await results(sae)).length;
    const onV3 = async () =>
      (await results(sae)).filter((r) => r.candidate_id === DANIEL && r.rubric_version_id === v3).length;
    const before = await all();
    const daniel = await onV3();
    // A resolution that names a version no longer approved is skipped, like a stale mapping.
    expect(await deliver(resolved(w1, DANIEL, sae, versions['sae2'] as string))).toEqual(['complete']);
    expect(await all()).toBe(before);

    const message = resolved(w1, DANIEL, sae, v3);
    expect(await deliver(message)).toEqual(['complete']);
    expect(await all()).toBe(before + 1);
    expect(await onV3()).toBe(daniel + 1);
    // Redelivery stores nothing more.
    expect(await deliver(message)).toEqual(['complete']);
    expect(await all()).toBe(before + 1);
    // Another workspace's message naming this job stores nothing.
    expect(await deliver(resolved(w2, DANIEL, sae, v3))).toEqual(['complete']);
    expect(await all()).toBe(before + 1);
  });
});
