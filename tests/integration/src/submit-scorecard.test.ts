import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { AssessmentContract } from '@credalent/assessment';
import { createAssessment } from '@credalent/assessment/composition';
import type { AuditContract } from '@credalent/audit';
import { createAudit } from '@credalent/audit/composition';
import { createCandidates, displayNamesInWorkspace } from '@credalent/candidates/composition';
import { createDb, withWorkspace, type Db } from '@credalent/db';
import type { EvidenceContract } from '@credalent/evidence';
import { createEvidence, readEvidenceForJobAsSystem } from '@credalent/evidence/composition';
import type { IntakeContract } from '@credalent/intake';
import { createCandidateJobResolver, createIntake, findApplication } from '@credalent/intake/composition';
import type { InterviewsContract, ScorecardDraft } from '@credalent/interviews';
import { createInterviews } from '@credalent/interviews/composition';
import type { Competency, JobsContract } from '@credalent/jobs';
import { createApprovedRubricReads, createJobs } from '@credalent/jobs/composition';
import { ForbiddenError, type WorkspaceContext, type WorkspacesContract } from '@credalent/workspaces';
import { createWorkspaces } from '@credalent/workspaces/composition';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// AIV-P2-006 against real PostgreSQL, connected as the non-owner aivera_app role (ADR-004, ADR-005): the real
// interviews, assessment, evidence and audit modules wired as apps/web/src/server wires them. Synthetic cast only. The
// numbers follow the scoring formula (Clearly shown adds Medium at the level the job needs: 55 to 67), not the ticket's
// illustrative 61 (owner decision, 20 Nov 2026). Two connections, so two submits can race for the interview's row.

const rolesSql = readFileSync(createRequire(import.meta.url).resolve('@credalent/db/sql/roles.sql'), 'utf8');
const dbCli = join(import.meta.dirname, '..', '..', '..', 'packages', 'db', 'src', 'cli.ts');

const id = (n: number) => `0190d4a2-0000-7000-8000-${n.toString(16).padStart(12, '0')}`;
const AYESHA = id(0xa1); // the recruiter who creates the workspaces (their admin)
const LINA = id(0xa2); // the interviewer on Daniel's interview, granted the job
const NOOR = id(0xa3); // another interviewer, granted the job but not on the interview
const FAISAL = id(0xa4); // a hiring owner with no grant on the job
const NOW = new Date('2026-11-26T09:00:00.000Z');
const NOTE = 'Walked through the 200-question set he built';

let container: StartedPostgreSqlContainer;
let admin: Db;
let app: Db;
let workspaces: WorkspacesContract;
let jobs: JobsContract;
let intake: IntakeContract;
let audit: AuditContract;
let evidence: EvidenceContract;
let assessment: AssessmentContract;
let interviews: InterviewsContract;
let failing: InterviewsContract;
let w1: string;
let w2: string;
let sae: string;
let rubric: NonNullable<Awaited<ReturnType<ReturnType<typeof createApprovedRubricReads>['approvedRubric']>>>;
let RETRIEVAL: string;
let COST: string;
let PYTHON: string;

const urlFor = (role: string) =>
  `postgres://${role}:local_dev_only@${container.getHost()}:${container.getPort()}/${container.getDatabase()}`;

const as = <T>(userId: string, workspaceId: string, fn: (ctx: WorkspaceContext) => Promise<T>) =>
  workspaces.withWorkspace({ userId }, workspaceId, fn);

const competency = (name: string, weightPercent: number, levelNeeded: number): Competency => ({
  name,
  evidenceExpected: `Evidence of ${name.toLowerCase()}`,
  weightPercent,
  levelNeeded,
  type: 'mandatory',
  origin: 'from_description',
});

/** The interviews module as apps/web wires it, with the assessment's apply replaceable to make it fail. */
const wire = (apply: AssessmentContract['applyScoreChange']) =>
  createInterviews(workspaces, jobs, createApprovedRubricReads().approvedRubric, findApplication, () => NOW, {
    latestAssessment: (ctx, candidateId, jobId) => assessment.getLatestAssessment(ctx, candidateId, jobId),
    previewScoreChange: (ctx, input) => assessment.previewScoreChange(ctx, input),
    applyScoreChange: apply,
    recordSummaryEvidence: (ctx, input) => evidence.recordInterviewSummary(ctx, input),
    // No questions were suggested for Daniel, so each competency shows the interviewer's own (apps/web reads the
    // assessment's stored set; the rebuild on it is unit-tested in modules/interviews).
    suggestedQuestions: async () => new Map(),
  });

let next = 0x1000;
/**
 * A fresh Daniel Novak (synthetic) on Senior AI Engineer: backed score 55, "Retrieval and evaluation" Supporting on a
 * CV claim, and a Round 1 interview with Lina, never scheduled (the pilot), testing retrieval and cost.
 */
const daniel = async () => {
  const n = next++;
  const { personId: candidateId, applicationId } = await as(AYESHA, w1, (ctx) =>
    intake.receiveApplication(ctx, {
      jobId: sae,
      person: {
        displayName: 'Daniel Novak',
        identifiers: [{ type: 'cv_hash', value: n.toString(16).padStart(64, '0') }],
        synthetic: true,
      },
      source: 'linkedin',
    }),
  );
  const record = (competencyId: string, level: number, kind: 'repository' | 'cv') =>
    as(AYESHA, w1, (ctx) =>
      evidence.recordEvidence(ctx, {
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
            excerptSpan: null,
            provenance: kind === 'cv' ? 'claim' : 'corroborated',
            strength: kind === 'cv' ? 'supporting' : 'strong',
            limit: kind === 'cv' ? 'A claim until a second source supports it.' : 'Shows the code, not its use.',
            competencies: [{ jobId: sae, competencyId, level }],
          },
        ],
        synthetic: true,
      }),
    );
  await record(PYTHON, 5, 'repository');
  await record(RETRIEVAL, 4, 'cv');
  const snapshot = await as(AYESHA, w1, async (ctx) =>
    assessment.assessCandidate(ctx, {
      candidateId,
      jobId: sae,
      rubric: { versionId: rubric.id, competencies: rubric.competencies },
      evidence: await evidence.listEvidenceForCandidate(ctx, candidateId, sae),
    }),
  );
  expect(snapshot.backedScore).toBe(55);
  const { interviewId } = await as(AYESHA, w1, (ctx) =>
    interviews.createInterview(ctx, {
      applicationId,
      round: 'structured_screen',
      interviewerUserId: LINA,
      competencyIds: [RETRIEVAL, COST],
    }),
  );
  return { candidateId, applicationId, interviewId };
};

/** Retrieval rated, with Lina's note; Cost and reliability "Not assessed in this round" (rated before it was marked). */
const rated = (): ScorecardDraft => ({
  competencies: [
    { competencyId: RETRIEVAL, rating: 'clearly_shown', note: NOTE, questions: [{ text: '', mark: null }] },
    { competencyId: COST, rating: 'partly_shown', note: '', questions: [{ text: '', mark: 'not_asked' }] },
  ],
  recommendation: 'not_recommended',
});

/** Lina saves the draft and previews its ratings, as the page does; the preview id, null with nothing rated. */
const prepared = async (interviewId: string, draft: ScorecardDraft) => {
  await as(LINA, w1, (ctx) => interviews.saveScorecardDraft(ctx, interviewId, draft));
  const ratings = draft.competencies.flatMap((c) =>
    c.rating && !c.questions.every((q) => q.mark) ? [{ competencyId: c.competencyId, rating: c.rating }] : [],
  );
  if (ratings.length === 0) return null;
  const preview = await as(LINA, w1, (ctx) => interviews.previewScorecardRatings(ctx, interviewId, ratings));
  return preview.previewId;
};

const submit = (interviewId: string, previewId: string | null, userId = LINA, workspaceId = w1, via = interviews) =>
  as(userId, workspaceId, (ctx) => via.submitScorecard(ctx, interviewId, { previewId }));

/** Everything a submit may write, counted for one candidate and interview. */
const written = async (candidateId: string, interviewId: string) => {
  const [rows] = await admin.execute<{
    status: string;
    results: number;
    changes: number;
    sources: number;
    completed: number;
  }>(sql`
    select (select status from interviews.interview where id = ${interviewId}) as status,
           (select count(*)::int from assessment.result where candidate_id = ${candidateId}) as results,
           (select count(*)::int from assessment.interview_change where candidate_id = ${candidateId}) as changes,
           (select count(*)::int from evidence.source where candidate_id = ${candidateId}) as sources,
           (select count(*)::int from interviews.outbox
             where type = 'InterviewCompleted.v1' and payload->>'interviewId' = ${interviewId}) as completed`);
  const entries = await audit.listFor(w1, { type: 'candidate', id: candidateId });
  return { ...rows, audited: entries.length };
};

const latest = (candidateId: string) => as(AYESHA, w1, (ctx) => assessment.getLatestAssessment(ctx, candidateId, sae));

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
  const applied = createCandidateJobResolver(jobs);
  intake = createIntake(workspaces, createCandidates(workspaces), jobs, displayNamesInWorkspace, audit, () => NOW);
  evidence = createEvidence(workspaces, audit, () => NOW, applied);
  assessment = createAssessment(workspaces, audit, jobs, () => NOW, applied, undefined, undefined, {
    evidenceForJob: readEvidenceForJobAsSystem,
    interviewOf: (ctx, interviewId) => interviews.getInterview(ctx, interviewId),
  });
  interviews = wire((ctx, input) => assessment.applyScoreChange(ctx, input));
  // The assessment write fails after it has run: everything before it in the transaction must roll back with it.
  failing = wire(async (ctx, input) => {
    await assessment.applyScoreChange(ctx, input);
    throw new Error('assessment write failed');
  });

  const workspace = (name: string) =>
    workspaces
      .createWorkspace({ name, company: name, hiringFocus: 'AI', synthetic: true, creatorUserId: AYESHA })
      .then((w) => w.id);
  w1 = await workspace('Demo hiring team');
  w2 = await workspace('Gulf Talent Partners');
  sae = await as(AYESHA, w1, (ctx) =>
    jobs.createJob(ctx, {
      title: 'Senior AI Engineer',
      jobType: 'ai_llm_engineering',
      hiringOwnerUserId: null,
      description: 'Senior AI Engineer, synthetic demo job.',
      synthetic: true,
    }),
  ).then((j) => j.id);
  const saved = await as(AYESHA, w1, (ctx) =>
    jobs.saveRubric(ctx, sae, {
      successStatement: 'Ships reliable AI features.',
      competencies: [
        competency('Python service engineering', 55, 4),
        competency('Retrieval and evaluation', 20, 3),
        competency('Cost and reliability', 25, 3),
      ],
    }),
  );
  const sent = await as(AYESHA, w1, (ctx) => jobs.submitRubric(ctx, saved.id));
  await as(AYESHA, w1, (ctx) => jobs.approveRubric(ctx, sent.id, sent.revision));
  const approved = await withWorkspace(app, w1, (tx) => createApprovedRubricReads().approvedRubric(tx, w1, sae));
  if (!approved) throw new Error('The rubric was not approved');
  rubric = approved;
  const idOf = (name: string) => rubric.competencies.find((c) => c.name === name)?.id ?? '';
  [PYTHON, RETRIEVAL, COST] = [
    idOf('Python service engineering'),
    idOf('Retrieval and evaluation'),
    idOf('Cost and reliability'),
  ];
  await withWorkspace(app, w1, (tx) =>
    tx.execute(sql`insert into workspaces.member (workspace_id, user_id, role, status) values
      (${w1}, ${LINA}, 'interviewer', 'active'), (${w1}, ${NOOR}, 'interviewer', 'active'),
      (${w1}, ${FAISAL}, 'hiring_owner', 'active')`),
  );
  for (const userId of [LINA, NOOR])
    await as(AYESHA, w1, (ctx) => workspaces.grantJobAccess(ctx, { userId, jobId: sae }));
});

afterAll(async () => {
  await app?.$client.end();
  await admin?.$client.end();
  await container?.stop();
});

describe('Scenario: Submitting applies the change', () => {
  it('completes the interview, records the note as evidence and gives a new snapshot the ranking reads: 55 to 67', async () => {
    const d = await daniel();
    const previewId = await prepared(d.interviewId, rated());
    expect(await submit(d.interviewId, previewId)).toEqual({ updated: true });

    expect((await latest(d.candidateId))?.backedScore).toBe(67);
    const ranking = await as(AYESHA, w1, (ctx) => assessment.listRanking(ctx, sae));
    expect(ranking.status === 'ranked' && ranking.rows.find((r) => r.candidateId === d.candidateId)?.backedScore).toBe(
      67,
    );
    expect(await written(d.candidateId, d.interviewId)).toMatchObject({
      status: 'completed',
      results: 2,
      changes: 1,
      sources: 3,
      completed: 1,
    });
    // The note, as the interviewer's word: Medium at the level the job needs, linked to its competency only.
    const items = await admin.execute<{ label: string; excerpt: string; strength: string; competency: string }>(sql`
      select s.label, i.excerpt, i.strength, l.competency_id as competency from evidence.item i
        join evidence.source s on s.id = i.source_id
        join evidence.competency_link l on l.item_id = i.id
       where s.candidate_id = ${d.candidateId} and s.kind = 'interview_note'`);
    expect(items).toEqual([
      { label: "Interviewer's scorecard, 26 Nov", excerpt: NOTE, strength: 'medium', competency: RETRIEVAL },
    ]);
  });
});

describe('Scenario: Only what the preview showed is recorded', () => {
  // SAFETY: mutation check: recorded Partly shown as a Claim-only item again -> this test failed (two interview_note
  // items, one the preview never showed).
  it('Not shown records its note as Claim only at no level; Partly shown, which changes nothing, records nothing', async () => {
    const d = await daniel();
    const draft: ScorecardDraft = {
      competencies: [
        {
          competencyId: RETRIEVAL,
          rating: 'not_shown',
          note: 'Could not say how the 71% was measured',
          questions: [{ text: '', mark: null }],
        },
        {
          competencyId: COST,
          rating: 'partly_shown',
          note: 'Explained the fix only',
          questions: [{ text: '', mark: null }],
        },
      ],
      recommendation: null,
    };
    await submit(d.interviewId, await prepared(d.interviewId, draft));
    const items = await admin.execute<{ excerpt: string; strength: string; level: number; competency: string }>(sql`
      select i.excerpt, i.strength, l.level, l.competency_id as competency from evidence.item i
        join evidence.source s on s.id = i.source_id
        join evidence.competency_link l on l.item_id = i.id
       where s.candidate_id = ${d.candidateId} and s.kind = 'interview_note'`);
    expect(items).toEqual([
      { excerpt: 'Could not say how the 71% was measured', strength: 'claim', level: 0, competency: RETRIEVAL },
    ]);
    // A claim already counts zero: weakening it to Claim only leaves the backed score where it was.
    expect((await latest(d.candidateId))?.backedScore).toBe(55);
  });
});

describe('Scenario: Every change is logged', () => {
  // SAFETY: mutation check: removed the `auditScoreChange` loop from the assessment's `applyScoreChange` -> this test
  // failed (no score.changed entry from Lina).
  it('one entry with Lina, the time, Supporting to Medium, 55 to 67 and her note; none for the competency not assessed', async () => {
    const d = await daniel();
    const before = (await audit.listFor(w1, { type: 'candidate', id: d.candidateId })).length;
    await submit(d.interviewId, await prepared(d.interviewId, rated()));
    const entries = (await audit.listFor(w1, { type: 'candidate', id: d.candidateId })).slice(before);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      action: 'score.changed',
      actor: { type: 'user', id: LINA },
      occurredAt: NOW,
      note: NOTE,
      before: { competencyId: RETRIEVAL, strength: 'supporting', backedScore: 55 },
      after: { competencyId: RETRIEVAL, strength: 'medium', backedScore: 67, interviewId: d.interviewId },
    });
  });
});

describe('Scenario: A competency not assessed in this round stays a gap', () => {
  it('with every competency not assessed the interview completes and no score, evidence or entry changes', async () => {
    const d = await daniel();
    const untested: ScorecardDraft = {
      competencies: rated().competencies.map((c) => ({ ...c, questions: [{ text: '', mark: 'not_answered' }] })),
      recommendation: 'more_evidence',
    };
    const before = await written(d.candidateId, d.interviewId);
    expect(await submit(d.interviewId, await prepared(d.interviewId, untested))).toEqual({ updated: false });
    expect(await written(d.candidateId, d.interviewId)).toEqual({ ...before, status: 'completed', completed: 1 });
    expect((await latest(d.candidateId))?.backedScore).toBe(55);
  });
});

describe('Scenario: Recommendation does not decide', () => {
  // SAFETY: mutation check: made `submitScorecard` set the application's stage to 'withdrawn' on "Do not recommend"
  // -> this test failed (stage withdrawn).
  it('"Do not recommend for Round 2" is stored on the scorecard; the stage is unchanged and he stays ranked', async () => {
    const d = await daniel();
    const [stage] = await admin.execute<{ stage: string }>(
      sql`select stage from intake.application where id = ${d.applicationId}`,
    );
    await submit(d.interviewId, await prepared(d.interviewId, rated()));
    expect(await admin.execute(sql`select stage from intake.application where id = ${d.applicationId}`)).toEqual([
      stage,
    ]);
    const scorecard = await as(LINA, w1, (ctx) => interviews.getScorecard(ctx, d.interviewId));
    expect(scorecard?.draft?.recommendation).toBe('not_recommended');
    expect(scorecard?.canEdit).toBe(false);
    const ranking = await as(AYESHA, w1, (ctx) => assessment.listRanking(ctx, sae));
    expect(ranking.status === 'ranked' && ranking.rows.some((r) => r.candidateId === d.candidateId)).toBe(true);
  });
});

describe('Scenario: Double submit', () => {
  // SAFETY: mutation check: removed the `interview.status === 'completed'` refusal -> this test failed (the second
  // submit was refused as "interview_not_held", not "Already submitted").
  it('a retry after the first committed is "Already submitted" and writes nothing', async () => {
    const d = await daniel();
    const previewId = await prepared(d.interviewId, rated());
    await submit(d.interviewId, previewId);
    const after = await written(d.candidateId, d.interviewId);
    await expect(submit(d.interviewId, previewId)).rejects.toThrow('Already submitted');
    expect(await written(d.candidateId, d.interviewId)).toEqual(after);
  });

  // SAFETY: mutation check: ignored `moveStatus`'s false (the race lost) -> this test failed (both submits went
  // through).
  it('two submits racing on two connections apply once: one wins, the other is "Already submitted"', async () => {
    const d = await daniel();
    const previewId = await prepared(d.interviewId, rated());
    const results = await Promise.allSettled([submit(d.interviewId, previewId), submit(d.interviewId, previewId)]);
    expect(results.map((r) => r.status).toSorted()).toEqual(['fulfilled', 'rejected']);
    const refused = results.find((r) => r.status === 'rejected');
    expect(refused?.status === 'rejected' && (refused.reason as Error).message).toBe('Already submitted');
    expect(await written(d.candidateId, d.interviewId)).toMatchObject({ changes: 1, sources: 3, completed: 1 });
  });
});

describe('Scenario: Failure leaves nothing half done', () => {
  // SAFETY: mutation check: `submitScorecard` swallowed the apply's error and returned -> this test failed (the submit
  // resolved, its writes committed).
  it('the assessment write fails: the interview is not completed, no evidence or entry exists, and the draft stays saved', async () => {
    const d = await daniel();
    const previewId = await prepared(d.interviewId, rated());
    const before = await written(d.candidateId, d.interviewId);
    await expect(submit(d.interviewId, previewId, LINA, w1, failing)).rejects.toThrow('assessment write failed');
    expect(await written(d.candidateId, d.interviewId)).toEqual(before);
    expect(before.status).toBe('to_schedule');
    const scorecard = await as(LINA, w1, (ctx) => interviews.getScorecard(ctx, d.interviewId));
    expect(scorecard?.draft?.competencies[0]).toMatchObject({ rating: 'clearly_shown', note: NOTE });
    // Try again: it goes through.
    expect(await submit(d.interviewId, previewId)).toEqual({ updated: true });
  });
});

describe('Scenario: Audit entries cannot be altered', () => {
  it("the application role cannot update or delete the submit's entry", async () => {
    const d = await daniel();
    await submit(d.interviewId, await prepared(d.interviewId, rated()));
    for (const statement of [
      sql`update audit.entry set note = 'rewritten' where action = 'score.changed'`,
      sql`delete from audit.entry where action = 'score.changed'`,
    ])
      await expect(withWorkspace(app, w1, (tx) => tx.execute(statement))).rejects.toThrow(/\(42501\)/u);
    const entries = await audit.listFor(w1, { type: 'candidate', id: d.candidateId });
    expect(entries.at(-1)?.note).toBe(NOTE);
  });
});

describe('Scenario: Only the interviewer, on a job they reach, submits', () => {
  it.each([
    ['another interviewer on the job', NOOR, ForbiddenError],
    ['a hiring owner with no grant on the job', FAISAL, ForbiddenError],
  ])('%s is refused and nothing is written', async (_who, userId, error) => {
    const d = await daniel();
    const previewId = await prepared(d.interviewId, rated());
    const before = await written(d.candidateId, d.interviewId);
    await expect(submit(d.interviewId, previewId, userId)).rejects.toBeInstanceOf(error);
    expect(await written(d.candidateId, d.interviewId)).toEqual(before);
  });

  it("another workspace's admin cannot find the interview", async () => {
    const d = await daniel();
    const previewId = await prepared(d.interviewId, rated());
    const before = await written(d.candidateId, d.interviewId);
    await expect(submit(d.interviewId, previewId, AYESHA, w2)).rejects.toThrow('Interview not found');
    expect(await written(d.candidateId, d.interviewId)).toEqual(before);
  });
});
