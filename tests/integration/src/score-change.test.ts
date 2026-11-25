import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { ScoreChangeError, type AssessmentContract, type Rating, type RubricInput } from '@credalent/assessment';
import { createAssessment } from '@credalent/assessment/composition';
import type { AuditContract } from '@credalent/audit';
import { createAudit } from '@credalent/audit/composition';
import { createCandidates, displayNamesInWorkspace } from '@credalent/candidates/composition';
import { createDb, withWorkspace, type Db } from '@credalent/db';
import type { EvidenceContract, RecordEvidenceInput } from '@credalent/evidence';
import { createEvidence, readEvidenceForJobAsSystem } from '@credalent/evidence/composition';
import type { IntakeContract } from '@credalent/intake';
import { createApplicationReads, createCandidateJobResolver, createIntake } from '@credalent/intake/composition';
import type { JobsContract } from '@credalent/jobs';
import { createJobs } from '@credalent/jobs/composition';
import { ForbiddenError, type WorkspaceContext, type WorkspacesContract } from '@credalent/workspaces';
import { createWorkspaces } from '@credalent/workspaces/composition';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { receiveConfirmed } from './confirmedBatch.ts';

// AIV-P1-117 against real PostgreSQL, connected as the non-owner aivera_app role (ADR-004, ADR-005), with real jobs and
// applications so the job scope is the stored one. Synthetic cast only. The numbers follow the scoring formula, not the
// scorecard artboard's illustrative ones (owner decision, 20 Nov 2026).

const rolesSql = readFileSync(createRequire(import.meta.url).resolve('@credalent/db/sql/roles.sql'), 'utf8');
const dbCli = join(import.meta.dirname, '..', '..', '..', 'packages', 'db', 'src', 'cli.ts');

const id = (n: number) => `0190d4a2-0000-7000-8000-${n.toString(16).padStart(12, '0')}`;
const AYESHA = id(0xa1); // the recruiter who creates the workspace (its admin)
const LINA = id(0xa2); // an interviewer granted the Senior AI Engineer job
const NOOR = id(0xa3); // an interviewer granted only the Senior Product Designer job
const NOW = new Date('2026-11-24T09:00:00.000Z');
const [PYTHON, RETRIEVAL, COST] = [id(0xc01), id(0xc02), id(0xc03)] as const;
const RUBRIC: RubricInput = {
  versionId: id(0xb02),
  competencies: [
    { id: PYTHON, weightPercent: 55, levelNeeded: 4, type: 'mandatory' },
    { id: RETRIEVAL, weightPercent: 20, levelNeeded: 3, type: 'mandatory' },
    { id: COST, weightPercent: 25, levelNeeded: 3, type: 'desirable' },
  ],
};

let container: StartedPostgreSqlContainer;
let admin: Db;
let app: Db;
let workspaces: WorkspacesContract;
let jobs: JobsContract;
let intake: IntakeContract;
let audit: AuditContract;
let evidence: EvidenceContract;
let assessment: AssessmentContract;
let w1: string;
let w2: string;
let sae: string; // Senior AI Engineer
// The interviews contract's `getInterview`, stubbed: what an interview id resolves to for anyone who may see it.
type Interview = { candidateId: string; jobId: string; competencyIds: string[]; status: string };
const interviews = new Map<string, Interview>();

const urlFor = (role: string) =>
  `postgres://${role}:local_dev_only@${container.getHost()}:${container.getPort()}/${container.getDatabase()}`;

const as = <T>(userId: string, workspaceId: string, fn: (ctx: WorkspaceContext) => Promise<T>) =>
  workspaces.withWorkspace({ userId }, workspaceId, fn);

const item = (
  candidateId: string,
  competencyId: string,
  level: number,
  kind: 'repository' | 'cv',
): RecordEvidenceInput => ({
  candidateId,
  source: {
    kind,
    label: kind === 'cv' ? 'CV' : 'rag-service',
    url: kind === 'cv' ? null : 'https://code.credalent.example/daniel/rag-service',
    blobFileId: null,
    capturedAt: new Date('2026-11-10T08:00:00.000Z'),
    checkedAt: kind === 'cv' ? null : new Date('2026-11-12T08:00:00.000Z'),
    checkMethod: kind === 'cv' ? null : 'Commit history',
  },
  items: [
    {
      excerpt: kind === 'cv' ? 'raised answer accuracy from 71% to 88%' : 'authored 301 of 340 commits',
      excerptSpan: kind === 'cv' ? 'page 1' : null,
      provenance: kind === 'cv' ? 'claim' : 'corroborated',
      strength: kind === 'cv' ? 'supporting' : 'strong',
      limit:
        kind === 'cv' ? 'A claim until a second source supports it.' : 'Shows the code, not its use in production.',
      competencies: [{ jobId: sae, competencyId, level }],
    },
  ],
  synthetic: true,
});

const assess = (candidateId: string, rubric = RUBRIC) =>
  as(AYESHA, w1, async (ctx) =>
    assessment.assessCandidate(ctx, {
      candidateId,
      jobId: sae,
      rubric,
      evidence: await evidence.listEvidenceForCandidate(ctx, candidateId, sae),
    }),
  );

let next = 0x1000;
/**
 * A fresh Daniel Novak (synthetic) applying to Senior AI Engineer: backed score 55, "Retrieval and evaluation"
 * Supporting on a CV claim, and one interview in progress that investigates retrieval and cost.
 */
const daniel = async (interview: Partial<Interview> = {}) => {
  const n = next++;
  const { personId: candidateId } = await as(AYESHA, w1, (ctx) =>
    receiveConfirmed(intake, ctx, {
      jobId: sae,
      person: {
        displayName: 'Daniel Novak',
        identifiers: [{ type: 'cv_hash', value: n.toString(16).padStart(64, '0') }],
        synthetic: true,
      },
      source: 'linkedin',
      fileIds: [crypto.randomUUID()],
    }),
  );
  const interviewId = id(n);
  interviews.set(interviewId, {
    candidateId,
    jobId: sae,
    competencyIds: [RETRIEVAL, COST],
    status: 'in_progress',
    ...interview,
  });
  await as(AYESHA, w1, async (ctx) => {
    await evidence.recordEvidence(ctx, item(candidateId, PYTHON, 5, 'repository'));
    await evidence.recordEvidence(ctx, item(candidateId, RETRIEVAL, 4, 'cv'));
  });
  const snapshot = await assess(candidateId);
  expect(snapshot.backedScore).toBe(55);
  return { candidateId, interviewId, snapshot };
};
type Daniel = { interviewId: string; snapshot: { id: string } };

const ratings = (d: Daniel, changes: [string, Rating][] = [[RETRIEVAL, 'clearly_shown']]) => ({
  assessmentId: d.snapshot.id,
  interviewId: d.interviewId,
  changes: changes.map(([competencyId, rating]) => ({ competencyId, rating })),
});

const preview = (
  d: Daniel,
  { userId = AYESHA, workspaceId = w1, changes = undefined as [string, Rating][] | undefined } = {},
) => as(userId, workspaceId, (ctx) => assessment.previewScoreChange(ctx, ratings(d, changes)));

const apply = (
  d: Daniel,
  previewId: string,
  {
    key = crypto.randomUUID(),
    userId = AYESHA,
    workspaceId = w1,
    reason = 'Defended the design in detail',
    changes = undefined as [string, Rating][] | undefined,
  } = {},
) =>
  as(userId, workspaceId, (ctx) =>
    assessment.applyScoreChange(ctx, { ...ratings(d, changes), previewId, reason, idempotencyKey: key }),
  );

/** Everything a score change may write, counted for one candidate. */
const written = async (candidateId: string, workspaceId = w1) => {
  const [rows] = await withWorkspace(app, workspaceId, (tx) =>
    tx.execute<{ results: number; changes: number }>(sql`
      select (select count(*)::int from assessment.result where candidate_id = ${candidateId}) as results,
             (select count(*)::int from assessment.interview_change where candidate_id = ${candidateId}) as changes`),
  );
  const entries = await audit.listFor(workspaceId, { type: 'candidate', id: candidateId });
  return { ...rows, audited: entries.filter((e) => e.action === 'score.changed').length };
};

beforeAll(async () => {
  container = await new PostgreSqlContainer('pgvector/pgvector:pg17').withDatabase('aivera').start();
  admin = createDb(container.getConnectionUri(), { max: 1 });
  await admin.$client.unsafe(rolesSql);
  execFileSync(process.execPath, [dbCli, 'migrate'], {
    env: { ...process.env, DATABASE_MIGRATOR_URL: urlFor('aivera_migrator') },
  });
  app = createDb(urlFor('aivera_app'), { max: 1 });
  audit = createAudit(app);
  workspaces = createWorkspaces(app, audit);
  jobs = createJobs(workspaces, audit, () => NOW);
  // The app's resolver (apps/web/src/server/assessment.ts): a job-named call is authorised against the stored application.
  const applied = createCandidateJobResolver(jobs);
  intake = createIntake(workspaces, createCandidates(workspaces), jobs, displayNamesInWorkspace, audit, () => NOW);
  evidence = createEvidence(workspaces, audit, () => NOW, applied);
  assessment = createAssessment(
    workspaces,
    audit,
    jobs,
    () => NOW,
    applied,
    createApplicationReads().candidatesForJob,
    undefined,
    {
      evidenceForJob: readEvidenceForJobAsSystem,
      interviewOf: async (_ctx, interviewId) => interviews.get(interviewId) ?? null,
    },
  );
  const workspace = (name: string) =>
    workspaces
      .createWorkspace({ name, company: name, hiringFocus: 'AI', synthetic: true, creatorUserId: AYESHA })
      .then((w) => w.id);
  const job = (title: string) =>
    as(AYESHA, w1, (ctx) =>
      jobs.createJob(ctx, {
        title,
        jobType: 'ai_llm_engineering',
        hiringOwnerUserId: null,
        description: `${title}, synthetic demo job.`,
        synthetic: true,
      }),
    ).then((j) => j.id);
  w1 = await workspace('Demo hiring team');
  w2 = await workspace('Gulf Talent Partners');
  sae = await job('Senior AI Engineer');
  const spd = await job('Senior Product Designer');
  for (const [userId, jobId] of [
    [LINA, sae],
    [NOOR, spd],
  ] as const) {
    await withWorkspace(app, w1, (tx) =>
      tx.execute(
        sql`insert into workspaces.member (workspace_id, user_id, role, status) values (${w1}, ${userId}, 'interviewer', 'active')`,
      ),
    );
    await as(AYESHA, w1, (ctx) => workspaces.grantJobAccess(ctx, { userId, jobId }));
  }
});

afterAll(async () => {
  await app?.$client.end();
  await admin?.$client.end();
  await container?.stop();
});

describe('Scenario: Preview changes nothing', () => {
  it('shows the strength and backed score before and after, and stores and audits nothing', async () => {
    const d = await daniel();
    const before = await written(d.candidateId);
    const shown = await preview(d);
    expect(shown).toMatchObject({
      assessmentId: d.snapshot.id,
      label: 'interviewer_word',
      backedScore: { from: 55, to: 67 },
      changes: [
        {
          competencyId: RETRIEVAL,
          rating: 'clearly_shown',
          from: { strength: 'supporting', provenLevel: 0 },
          to: { strength: 'medium', provenLevel: 3 },
        },
      ],
    });
    expect(await written(d.candidateId)).toEqual(before);
    expect((await as(AYESHA, w1, (ctx) => assessment.getLatestAssessment(ctx, d.candidateId, sae)))?.id).toBe(
      d.snapshot.id,
    );
  });
});

describe('Scenario: Apply with a reason', () => {
  // SAFETY: mutation check: removed the auditScoreChange loop from applyScoreChange -> this test failed (no entry for the change)
  it('stores a new snapshot citing the interview, and one audit entry per changed competency with actor, time, before, after and reason', async () => {
    const d = await daniel();
    const stored = await apply(d, (await preview(d)).previewId);
    expect(stored.id).not.toBe(d.snapshot.id);
    expect([stored.backedScore, stored.assessedAt]).toEqual([67, NOW]);
    expect(stored.competencies.find((c) => c.competencyId === RETRIEVAL)?.proven).toEqual({
      level: 3,
      itemIds: [d.interviewId],
    });
    expect(await as(AYESHA, w1, (ctx) => assessment.getLatestAssessment(ctx, d.candidateId, sae))).toEqual(stored);

    const entries = (await audit.listFor(w1, { type: 'candidate', id: d.candidateId })).filter(
      (e) => e.action === 'score.changed',
    );
    expect(entries).toHaveLength(2); // the first assessment, then the one changed competency
    expect(entries[1]).toMatchObject({
      actor: { type: 'user', id: AYESHA },
      note: 'Defended the design in detail',
      before: {
        resultId: d.snapshot.id,
        competencyId: RETRIEVAL,
        strength: 'supporting',
        provenLevel: 0,
        backedScore: 55,
      },
      after: {
        resultId: stored.id,
        competencyId: RETRIEVAL,
        strength: 'medium',
        provenLevel: 3,
        backedScore: 67,
        rating: 'clearly_shown',
        interviewId: d.interviewId,
      },
    });
    expect(entries[1]?.occurredAt).toBeInstanceOf(Date);
  });

  // SAFETY: mutation check: audited only the first changed competency -> this test failed (one entry, not two)
  it('two competencies changed in one apply give one snapshot and two audit entries, each with its own competency, before and after', async () => {
    const d = await daniel();
    const changes: [string, Rating][] = [
      [RETRIEVAL, 'clearly_shown'],
      [COST, 'strongly_shown'],
    ];
    const before = await written(d.candidateId);
    const stored = await apply(d, (await preview(d, { changes })).previewId, { changes });
    expect(stored.backedScore).toBe(82);
    expect(await written(d.candidateId)).toEqual({
      results: (before.results ?? 0) + 1,
      changes: 2,
      audited: before.audited + 2,
    });
    const entries = (await audit.listFor(w1, { type: 'candidate', id: d.candidateId })).slice(-2);
    expect(entries.map((e) => [e.note, e.before, e.after])).toEqual([
      [
        'Defended the design in detail',
        { resultId: d.snapshot.id, competencyId: RETRIEVAL, strength: 'supporting', provenLevel: 0, backedScore: 55 },
        {
          resultId: stored.id,
          competencyId: RETRIEVAL,
          strength: 'medium',
          provenLevel: 3,
          backedScore: 82,
          rating: 'clearly_shown',
          interviewId: d.interviewId,
        },
      ],
      [
        'Defended the design in detail',
        { resultId: d.snapshot.id, competencyId: COST, strength: null, provenLevel: 0, backedScore: 55 },
        {
          resultId: stored.id,
          competencyId: COST,
          strength: 'medium',
          provenLevel: 3,
          backedScore: 82,
          rating: 'strongly_shown',
          interviewId: d.interviewId,
        },
      ],
    ]);
  });

  it('a later assessment from the same evidence on the same rubric version keeps the change, and stores nothing new', async () => {
    const d = await daniel();
    const stored = await apply(d, (await preview(d)).previewId);
    expect((await assess(d.candidateId)).id).toBe(stored.id);
  });

  it('a rating that changes nothing stores and audits nothing', async () => {
    const d = await daniel();
    const changes: [string, Rating][] = [[RETRIEVAL, 'partly_shown']];
    const before = await written(d.candidateId);
    const same = await apply(d, (await preview(d, { changes })).previewId, { changes });
    expect(same.id).toBe(d.snapshot.id);
    expect(await written(d.candidateId)).toEqual(before);
  });

  it('refuses an apply with no reason, an interview of another candidate, and a competency outside the rubric', async () => {
    const d = await daniel();
    const other = await daniel();
    const { previewId } = await preview(d);
    const before = await written(d.candidateId);
    await expect(apply(d, previewId, { reason: '  ' })).rejects.toThrow();
    await expect(preview({ ...d, interviewId: other.interviewId })).rejects.toMatchObject({ code: 'source_not_found' });
    await expect(apply({ ...d, interviewId: other.interviewId }, previewId)).rejects.toMatchObject({
      code: 'source_not_found',
    });
    interviews.get(d.interviewId)?.competencyIds.push(id(0xdead));
    await expect(preview(d, { changes: [[id(0xdead), 'clearly_shown']] })).rejects.toMatchObject({
      code: 'competency_not_in_rubric',
    });
    expect(await written(d.candidateId)).toEqual(before);
  });

  // SAFETY: mutation check: removed the competencyIds check from prepare -> this test failed (a competency the interview never investigated was changed)
  it('refuses a rating for a competency the interview does not investigate', async () => {
    const d = await daniel({ competencyIds: [RETRIEVAL] });
    const changes: [string, Rating][] = [[COST, 'strongly_shown']];
    await expect(preview(d, { changes })).rejects.toMatchObject({ code: 'competency_not_in_interview' });
    await expect(apply(d, 'any', { changes })).rejects.toMatchObject({ code: 'competency_not_in_interview' });
    expect((await written(d.candidateId)).changes).toBe(0);
  });

  // SAFETY: mutation check: removed the HELD check from prepare -> this test failed (a cancelled interview changed the score)
  it.each(['scheduled', 'cancelled'])('refuses an interview that was not held: %s', async (status) => {
    const d = await daniel({ status });
    await expect(preview(d)).rejects.toMatchObject({ code: 'interview_not_held' });
    await expect(apply(d, 'any')).rejects.toMatchObject({ code: 'interview_not_held' });
    expect((await written(d.candidateId)).changes).toBe(0);
  });
});

describe('Scenario: A stale preview is refused', () => {
  // SAFETY: mutation check: removed the latest-snapshot check from prepare -> this test failed (the old preview was applied)
  it('applies nothing once the assessment changed after the preview, and asks to preview again', async () => {
    const d = await daniel();
    const { previewId } = await preview(d);
    // Scored again on a newly approved rubric version, whose competencies have new ids as in production: a new latest snapshot.
    const changed = await assess(d.candidateId, {
      versionId: id(0xb03),
      competencies: RUBRIC.competencies.map((c, i) => ({ ...c, id: id(0xd01 + i) })),
    });
    expect(changed.id).not.toBe(d.snapshot.id);
    const before = await written(d.candidateId);
    const refusal = await apply(d, previewId).catch((error: unknown) => error);
    expect(refusal).toBeInstanceOf(ScoreChangeError);
    expect(refusal).toMatchObject({ code: 'stale', message: expect.stringContaining('Preview the change again') });
    expect(await written(d.candidateId)).toEqual(before);
  });

  // SAFETY: mutation check: removed the previewId comparison from applyScoreChange -> this test failed (a result the person never saw was applied)
  it('refuses a preview id that is not the result of these ratings on this snapshot', async () => {
    const d = await daniel();
    const { previewId } = await preview(d);
    const before = await written(d.candidateId);
    await expect(apply(d, previewId, { changes: [[RETRIEVAL, 'strongly_shown']] })).rejects.toMatchObject({
      code: 'stale',
    });
    expect(await written(d.candidateId)).toEqual(before);
  });

  // SAFETY: mutation check: removed the sameResult check from prepare -> this test failed (the preview folded the unscored evidence in)
  it('refuses evidence the worker has not scored yet, so no unaudited change rides along', async () => {
    const d = await daniel();
    await as(AYESHA, w1, (ctx) => evidence.recordEvidence(ctx, item(d.candidateId, COST, 3, 'repository')));
    await expect(preview(d)).rejects.toMatchObject({ code: 'not_yet_scored' });
  });
});

describe('Scenario: Applying twice is safe', () => {
  // SAFETY: mutation check: removed the idempotency lookup from applyScoreChange -> this test failed (the retry was refused as stale)
  it('the same apply sent twice with one idempotency key leaves one snapshot and one set of audit entries', async () => {
    const d = await daniel();
    const { previewId } = await preview(d);
    const key = crypto.randomUUID();
    const before = await written(d.candidateId);
    const first = await apply(d, previewId, { key });
    const second = await apply(d, previewId, { key });
    expect(second).toEqual(first);
    expect(await written(d.candidateId)).toEqual({
      results: (before.results ?? 0) + 1,
      changes: 1,
      audited: before.audited + 1,
    });
  });

  // SAFETY: mutation check: removed the previewId and reason comparison on an idempotency hit -> this test failed (the first result was returned for a different change)
  it('the same key with another reason or other ratings is a conflict, and writes nothing', async () => {
    const d = await daniel();
    const { previewId } = await preview(d);
    const key = crypto.randomUUID();
    await apply(d, previewId, { key });
    const before = await written(d.candidateId);
    await expect(apply(d, previewId, { key, reason: 'Another reason' })).rejects.toMatchObject({
      code: 'idempotency_conflict',
    });
    await expect(apply(d, 'another-preview', { key, changes: [[RETRIEVAL, 'strongly_shown']] })).rejects.toMatchObject({
      code: 'idempotency_conflict',
    });
    expect(await written(d.candidateId)).toEqual(before);
  });

  // SAFETY: mutation check: looked the key up by candidate and job again -> this test failed (a raw unique violation, not the typed conflict)
  it("a key already used for another candidate's change is a conflict", async () => {
    const [d, other] = [await daniel(), await daniel()];
    const key = crypto.randomUUID();
    await apply(d, (await preview(d)).previewId, { key });
    const before = await written(other.candidateId);
    await expect(apply(other, (await preview(other)).previewId, { key })).rejects.toMatchObject({
      code: 'idempotency_conflict',
    });
    expect(await written(other.candidateId)).toEqual(before);
  });

  // SAFETY: mutation check: dropped the unique index interview_change_idempotency_idx -> this test failed (a second row was stored)
  it('the database refuses a second change of one competency under one idempotency key, and any rewrite', async () => {
    const d = await daniel();
    await apply(d, (await preview(d)).previewId);
    await expect(
      withWorkspace(app, w1, (tx) =>
        tx.execute(sql`
          insert into assessment.interview_change
          select ${crypto.randomUUID()}::uuid, workspace_id, candidate_id, job_id, result_id, competency_id, source_id,
                 rating, level, item_ids, reason, applied_by, applied_at, idempotency_key, preview_id
          from assessment.interview_change where candidate_id = ${d.candidateId}`),
      ),
    ).rejects.toThrow();
    await expect(
      withWorkspace(app, w1, (tx) => tx.execute(sql`update assessment.interview_change set rating = 'not_shown'`)),
    ).rejects.toThrow();
  });
});

describe("Scenario: The interviewer's word is not verification", () => {
  it('the change is labelled as the interviewer’s word and stored as its own source; the claim beside it stays a claim', async () => {
    const d = await daniel();
    const shown = await preview(d);
    expect(shown.label).toBe('interviewer_word');
    const stored = await apply(d, shown.previewId);
    const retrieval = stored.competencies.find((c) => c.competencyId === RETRIEVAL);
    const [cv] = (await as(AYESHA, w1, (ctx) => evidence.listEvidenceForCandidate(ctx, d.candidateId, sae))).filter(
      (i) => i.source.kind === 'cv',
    );
    // The CV claim is not corroborated by the interview: still cited as a claim, and still a claim in the evidence.
    expect(retrieval?.proven.itemIds).toEqual([d.interviewId]);
    expect(retrieval?.claimItemIds).toEqual([cv?.id]);
    expect(cv?.provenance).toBe('claim');
    const [row] = await withWorkspace(app, w1, (tx) =>
      tx.execute(sql`select source_id, rating, level, applied_by, reason from assessment.interview_change
                     where candidate_id = ${d.candidateId}`),
    );
    expect(row).toEqual({
      source_id: d.interviewId,
      rating: 'clearly_shown',
      level: 3,
      applied_by: AYESHA,
      reason: 'Defended the design in detail',
    });
  });

  // SAFETY: mutation check: applyScoreChange returned early when no rating moved the score -> this test failed (nothing stored or audited)
  it('Not shown leaves independently corroborated work as it is, and is still stored and audited with no new snapshot', async () => {
    const d = await daniel({ competencyIds: [PYTHON] });
    const changes: [string, Rating][] = [[PYTHON, 'not_shown']];
    const shown = await preview(d, { changes });
    expect(shown).toMatchObject({
      backedScore: { from: 55, to: 55 },
      changes: [{ competencyId: PYTHON, rating: 'not_shown', noChange: 'outranked_by_checked_work' }],
    });
    const before = await written(d.candidateId);
    const same = await apply(d, shown.previewId, { changes, reason: 'Could not explain the service design' });
    expect(same.id).toBe(d.snapshot.id);
    expect(await written(d.candidateId)).toEqual({ ...before, changes: 1, audited: before.audited + 1 });
    const entry = (await audit.listFor(w1, { type: 'candidate', id: d.candidateId })).at(-1);
    const state = {
      resultId: d.snapshot.id,
      competencyId: PYTHON,
      strength: 'strong',
      provenLevel: 5,
      backedScore: 55,
    };
    expect(entry).toMatchObject({
      note: 'Could not explain the service design',
      before: state,
      after: { ...state, rating: 'not_shown', interviewId: d.interviewId },
    });
    // The stored rating does not make the next preview stale.
    await expect(preview(d, { changes })).resolves.toMatchObject({ assessmentId: d.snapshot.id });
  });
});

/** An item the caller records as the interview's write-up, in the transaction that applies the change. */
const writeUp = (candidateId: string, level: number): RecordEvidenceInput => ({
  candidateId,
  source: {
    kind: 'interview_note',
    label: "Interviewer's summary, 24 Nov",
    url: null,
    blobFileId: null,
    capturedAt: NOW,
    checkedAt: null,
    checkMethod: null,
  },
  items: [
    {
      excerpt: 'walked through the 200-question evaluation set he built',
      excerptSpan: null,
      provenance: 'submitted',
      strength: 'medium',
      limit: "The interviewer's summary of the interview: their word, not inspected work.",
      competencies: [{ jobId: sae, competencyId: RETRIEVAL, level }],
    },
  ],
  synthetic: true,
});

const applyWith = (d: Daniel & { candidateId: string }, previewId: string, level: number) =>
  as(AYESHA, w1, async (ctx) => {
    const { itemIds } = await evidence.recordEvidence(ctx, writeUp(d.candidateId, level));
    const stored = await assessment.applyScoreChange(ctx, {
      ...ratings(d),
      previewId,
      reason: 'Overall reason',
      reasons: { [RETRIEVAL]: 'He built the set himself' },
      idempotencyKey: crypto.randomUUID(),
      writeUpItemIds: itemIds,
    });
    return { stored, itemId: itemIds[0] ?? '' };
  });

describe("The interview's write-up and a reason per competency (AIV-P1-115)", () => {
  it('evidence recorded with the apply is cited beside the interview, the score is the previewed one, and the audit note is that competency’s reason', async () => {
    const d = await daniel();
    const shown = await preview(d);
    const { stored, itemId } = await applyWith(d, shown.previewId, 3);
    expect(stored.backedScore).toBe(shown.backedScore.to);
    expect(stored.competencies.find((c) => c.competencyId === RETRIEVAL)?.proven).toEqual({
      level: 3,
      itemIds: [d.interviewId, itemId].toSorted(),
    });
    const entries = await audit.listFor(w1, { type: 'candidate', id: d.candidateId });
    expect(entries.at(-1)).toMatchObject({ action: 'score.changed', note: 'He built the set himself' });
    // The worker's next run over the same evidence stores nothing new.
    expect((await assess(d.candidateId)).id).toBe(stored.id);
  });

  // SAFETY: mutation check: removed the `write_up_moves_score` guard from prepare -> this test failed (the apply went through)
  it('a write-up that would move the score beyond the preview is refused, and nothing is stored', async () => {
    const d = await daniel();
    const { previewId } = await preview(d);
    const before = await written(d.candidateId);
    await expect(applyWith(d, previewId, 4)).rejects.toMatchObject({ code: 'write_up_moves_score' });
    expect(await written(d.candidateId)).toEqual(before);
    const items = await as(AYESHA, w1, (ctx) => evidence.listEvidenceForCandidate(ctx, d.candidateId, sae));
    expect(items.filter((i) => i.source.kind === 'interview_note')).toEqual([]);
  });
});

describe('Scenario: Another workspace', () => {
  // SAFETY: mutation check: removed the workspace filter from assessmentStore.byId -> this test still passed on RLS alone;
  // ALTER POLICY result_tenant_isolation USING (true) as well -> this test failed (W2 previewed W1's assessment)
  it('a preview or an apply of another workspace’s assessment is refused, and nothing is read or written', async () => {
    const d = await daniel();
    const { previewId } = await preview(d);
    const before = await written(d.candidateId);
    await expect(preview(d, { workspaceId: w2 })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(apply(d, previewId, { workspaceId: w2 })).rejects.toBeInstanceOf(ForbiddenError);
    expect(await written(d.candidateId)).toEqual(before);
    expect(await written(d.candidateId, w2)).toEqual({ results: 0, changes: 0, audited: 0 });
  });

  // SAFETY: mutation check: ALTER POLICY interview_change_tenant_isolation USING (true) WITH CHECK (true) -> this test failed (W2 saw W1's rows)
  it("W2 reads none of W1's interview changes with no WHERE clause, and W1 cannot write one for W2", async () => {
    const d = await daniel();
    await apply(d, (await preview(d)).previewId);
    expect([
      ...(await withWorkspace(app, w2, (tx) => tx.execute(sql`select * from assessment.interview_change`))),
    ]).toEqual([]);
    const [own] = await withWorkspace(app, w1, (tx) =>
      tx.execute<{ n: number }>(sql`select count(*)::int as n from assessment.interview_change`),
    );
    expect(own?.n).toBeGreaterThan(0);
    await expect(
      withWorkspace(app, w1, (tx) =>
        tx.execute(sql`
          insert into assessment.interview_change
          select ${crypto.randomUUID()}::uuid, ${w2}::uuid, candidate_id, job_id, result_id, competency_id, source_id,
                 rating, level, item_ids, reason, applied_by, applied_at, ${crypto.randomUUID()}::uuid, preview_id
          from assessment.interview_change limit 1`),
      ),
    ).rejects.toThrow();
  });
});

describe('Who may preview and apply', () => {
  // SAFETY: mutation check: granted LINA the other job instead -> this test failed (ForbiddenError)
  it('an interviewer granted the job previews and applies, and the audit entry names her', async () => {
    const d = await daniel();
    const shown = await preview(d, { userId: LINA });
    const stored = await apply(d, shown.previewId, { userId: LINA });
    expect(stored.backedScore).toBe(67);
    const entries = await audit.listFor(w1, { type: 'candidate', id: d.candidateId });
    expect(entries.at(-1)).toMatchObject({ action: 'score.changed', actor: { type: 'user', id: LINA } });
  });

  // SAFETY: mutation check: removed the authorize call from scoreChange.ts `authorised` -> this test failed (she previewed and applied).
  // grantsCover covering any job (modules/workspaces/src/domain/permissions.ts) -> still passed: the jobs module hides the
  // job from her, so no job is named and a job-scoped role with no job is refused (the second layer).
  it('an interviewer granted only another job can neither preview nor apply', async () => {
    const d = await daniel();
    const { previewId } = await preview(d);
    const before = await written(d.candidateId);
    await expect(preview(d, { userId: NOOR })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(apply(d, previewId, { userId: NOOR })).rejects.toBeInstanceOf(ForbiddenError);
    expect(await written(d.candidateId)).toEqual(before);
  });

  it('table assessment.interview_change is owned by aivera_migrator with row-level security enabled and forced', async () => {
    const [table] = await admin.execute(sql`
      select t.tableowner as owner, c.relrowsecurity as rls, c.relforcerowsecurity as forced
      from pg_tables t join pg_class c on c.oid = format('%I.%I', t.schemaname, t.tablename)::regclass
      where t.schemaname = 'assessment' and t.tablename = 'interview_change'`);
    expect(table).toEqual({ owner: 'aivera_migrator', rls: true, forced: true });
  });
});
