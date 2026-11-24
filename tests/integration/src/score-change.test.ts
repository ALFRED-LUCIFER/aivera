import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { ScoreChangeError, type AssessmentContract, type RubricInput } from '@credalent/assessment';
import { createAssessment } from '@credalent/assessment/composition';
import type { AuditContract } from '@credalent/audit';
import { createAudit } from '@credalent/audit/composition';
import { createDb, withWorkspace, type Db } from '@credalent/db';
import type { EvidenceContract, RecordEvidenceInput } from '@credalent/evidence';
import { createEvidence, readEvidenceForJobAsSystem } from '@credalent/evidence/composition';
import { createJobs } from '@credalent/jobs/composition';
import { ForbiddenError, type WorkspaceContext, type WorkspacesContract } from '@credalent/workspaces';
import { createWorkspaces } from '@credalent/workspaces/composition';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// AIV-P1-117 against real PostgreSQL, connected as the non-owner aivera_app role (ADR-004, ADR-005). Synthetic cast only.
// The numbers follow the scoring formula, not the scorecard artboard's illustrative ones (owner decision, 20 Nov 2026).

const rolesSql = readFileSync(createRequire(import.meta.url).resolve('@credalent/db/sql/roles.sql'), 'utf8');
const dbCli = join(import.meta.dirname, '..', '..', '..', 'packages', 'db', 'src', 'cli.ts');

const id = (n: number) => `0190d4a2-0000-7000-8000-${n.toString(16).padStart(12, '0')}`;
const AYESHA = id(0xa1); // the recruiter who creates the workspace (its admin)
const LINA = id(0xa2); // an interviewer with no grant on the job
const NOW = new Date('2026-11-24T09:00:00.000Z');
const JOB = id(0xb01);
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
let audit: AuditContract;
let evidence: EvidenceContract;
let assessment: AssessmentContract;
let w1: string;
let w2: string;
// The interviews contract's `getInterview`, stubbed: interview id to its candidate and job.
const interviews = new Map<string, { candidateId: string; jobId: string }>();

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
      competencies: [{ jobId: JOB, competencyId, level }],
    },
  ],
  synthetic: true,
});

const assess = (workspaceId: string, candidateId: string, rubric = RUBRIC) =>
  as(AYESHA, workspaceId, async (ctx) =>
    assessment.assessCandidate(ctx, {
      candidateId,
      jobId: JOB,
      rubric,
      evidence: await evidence.listEvidenceForCandidate(ctx, candidateId, JOB),
    }),
  );

let next = 0x1000;
/** A fresh Daniel Novak (synthetic): backed score 55, "Retrieval and evaluation" Supporting on a CV claim, one interview. */
const daniel = async (workspaceId = w1) => {
  const candidateId = id(next++);
  const interviewId = id(next++);
  interviews.set(interviewId, { candidateId, jobId: JOB });
  await as(AYESHA, workspaceId, async (ctx) => {
    await evidence.recordEvidence(ctx, item(candidateId, PYTHON, 5, 'repository'));
    await evidence.recordEvidence(ctx, item(candidateId, RETRIEVAL, 4, 'cv'));
  });
  const snapshot = await assess(workspaceId, candidateId);
  expect(snapshot.backedScore).toBe(55);
  return { candidateId, interviewId, snapshot };
};

const clearly = (d: { interviewId: string; snapshot: { id: string } }) => ({
  assessmentId: d.snapshot.id,
  interviewId: d.interviewId,
  changes: [{ competencyId: RETRIEVAL, rating: 'clearly_shown' as const }],
});

const preview = (d: Parameters<typeof clearly>[0], userId = AYESHA, workspaceId = w1) =>
  as(userId, workspaceId, (ctx) => assessment.previewScoreChange(ctx, clearly(d)));

const apply = (
  d: Parameters<typeof clearly>[0],
  previewId: string,
  { key = crypto.randomUUID(), userId = AYESHA, workspaceId = w1, reason = 'Defended the design in detail' } = {},
) =>
  as(userId, workspaceId, (ctx) =>
    assessment.applyScoreChange(ctx, { ...clearly(d), previewId, reason, idempotencyKey: key }),
  );

/** Everything a score change may write, counted for one candidate. */
const written = async (candidateId: string, workspaceId = w1) => {
  const [rows] = await withWorkspace(app, workspaceId, (tx) =>
    tx.execute<{ results: number; changes: number }>(sql`
      select (select count(*)::int from assessment.result where candidate_id = ${candidateId}) as results,
             (select count(*)::int from assessment.interview_change where candidate_id = ${candidateId}) as changes`),
  );
  const entries = await audit.listFor(workspaceId, { type: 'candidate', id: candidateId });
  return { ...rows, audited: entries.length };
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
  evidence = createEvidence(workspaces, audit, () => NOW);
  assessment = createAssessment(
    workspaces,
    audit,
    createJobs(workspaces, audit, () => NOW),
    () => NOW,
    undefined,
    undefined,
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
  w1 = await workspace('Demo hiring team');
  w2 = await workspace('Gulf Talent Partners');
  await withWorkspace(app, w1, (tx) =>
    tx.execute(
      sql`insert into workspaces.member (workspace_id, user_id, role, status) values (${w1}, ${LINA}, 'interviewer', 'active')`,
    ),
  );
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
      backedScore: { from: 55, to: 71 },
      changes: [
        {
          competencyId: RETRIEVAL,
          rating: 'clearly_shown',
          from: { strength: 'supporting', provenLevel: 0 },
          to: { strength: 'medium', provenLevel: 4 },
        },
      ],
    });
    expect(await written(d.candidateId)).toEqual(before);
    expect((await as(AYESHA, w1, (ctx) => assessment.getLatestAssessment(ctx, d.candidateId, JOB)))?.id).toBe(
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
    expect([stored.backedScore, stored.assessedAt]).toEqual([71, NOW]);
    expect(stored.competencies.find((c) => c.competencyId === RETRIEVAL)?.proven).toEqual({
      level: 4,
      itemIds: [d.interviewId],
    });
    expect(await as(AYESHA, w1, (ctx) => assessment.getLatestAssessment(ctx, d.candidateId, JOB))).toEqual(stored);

    const entries = await audit.listFor(w1, { type: 'candidate', id: d.candidateId });
    expect(entries).toHaveLength(2); // the first assessment, then the one changed competency
    expect(entries[1]).toMatchObject({
      action: 'score.changed',
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
        provenLevel: 4,
        backedScore: 71,
        rating: 'clearly_shown',
        interviewId: d.interviewId,
      },
    });
    expect(entries[1]?.occurredAt).toBeInstanceOf(Date);
  });

  it('a later assessment from the same evidence keeps the change, and stores nothing new', async () => {
    const d = await daniel();
    const stored = await apply(d, (await preview(d)).previewId);
    expect((await assess(w1, d.candidateId)).id).toBe(stored.id);
  });

  it('a rating that changes nothing stores and audits nothing', async () => {
    const d = await daniel();
    const input = { ...clearly(d), changes: [{ competencyId: RETRIEVAL, rating: 'partly_shown' as const }] };
    const before = await written(d.candidateId);
    const same = await as(AYESHA, w1, async (ctx) =>
      assessment.applyScoreChange(ctx, {
        ...input,
        previewId: (await assessment.previewScoreChange(ctx, input)).previewId,
        reason: 'Answered in outline only',
        idempotencyKey: crypto.randomUUID(),
      }),
    );
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
    await expect(
      as(AYESHA, w1, (ctx) =>
        assessment.previewScoreChange(ctx, {
          ...clearly(d),
          changes: [{ competencyId: id(0xdead), rating: 'clearly_shown' }],
        }),
      ),
    ).rejects.toMatchObject({ code: 'competency_not_in_rubric' });
    expect(await written(d.candidateId)).toEqual(before);
  });
});

describe('Scenario: A stale preview is refused', () => {
  // SAFETY: mutation check: removed the latest-snapshot check from prepare -> this test failed (the old preview was applied)
  it('applies nothing once the assessment changed after the preview, and asks to preview again', async () => {
    const d = await daniel();
    const { previewId } = await preview(d);
    // The same evidence scored again on a newly approved rubric version: a new latest snapshot.
    const changed = await assess(w1, d.candidateId, { ...RUBRIC, versionId: id(0xb03) });
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
    const strongly = { ...clearly(d), changes: [{ competencyId: RETRIEVAL, rating: 'strongly_shown' as const }] };
    await expect(
      as(AYESHA, w1, (ctx) =>
        assessment.applyScoreChange(ctx, {
          ...strongly,
          previewId,
          reason: 'Defended the design in detail',
          idempotencyKey: crypto.randomUUID(),
        }),
      ),
    ).rejects.toMatchObject({ code: 'stale' });
    expect(await written(d.candidateId)).toEqual(before);
  });

  // SAFETY: mutation check: removed the sameResult check from prepare -> this test failed (the preview folded the unscored evidence in)
  it('refuses evidence the worker has not scored yet, so no unaudited change rides along', async () => {
    const d = await daniel();
    await as(AYESHA, w1, (ctx) => evidence.recordEvidence(ctx, item(d.candidateId, COST, 3, 'repository')));
    await expect(preview(d)).rejects.toMatchObject({ code: 'stale' });
  });
});

describe('Scenario: Applying twice is safe', () => {
  // SAFETY: mutation check: removed the appliedResult lookup from applyScoreChange -> this test failed (the retry was refused as stale)
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

  // SAFETY: mutation check: dropped the unique index interview_change_idempotency_idx -> this test failed (a second row was stored)
  it('the database refuses a second change of one competency under one idempotency key, and any rewrite', async () => {
    const d = await daniel();
    await apply(d, (await preview(d)).previewId);
    await expect(
      withWorkspace(app, w1, (tx) =>
        tx.execute(sql`
          insert into assessment.interview_change
          select ${crypto.randomUUID()}::uuid, workspace_id, candidate_id, job_id, result_id, competency_id, source_id,
                 strength, level, item_ids, reason, applied_by, applied_at, idempotency_key
          from assessment.interview_change where candidate_id = ${d.candidateId}`),
      ),
    ).rejects.toThrow();
    await expect(
      withWorkspace(app, w1, (tx) => tx.execute(sql`update assessment.interview_change set strength = 'strong'`)),
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
    const [cv] = (await as(AYESHA, w1, (ctx) => evidence.listEvidenceForCandidate(ctx, d.candidateId, JOB))).filter(
      (i) => i.source.kind === 'cv',
    );
    // The CV claim is not corroborated by the interview: still cited as a claim, and still a claim in the evidence.
    expect(retrieval?.proven.itemIds).toEqual([d.interviewId]);
    expect(retrieval?.claimItemIds).toEqual([cv?.id]);
    expect(cv?.provenance).toBe('claim');
    const [row] = await withWorkspace(app, w1, (tx) =>
      tx.execute(sql`select source_id, strength, applied_by, reason from assessment.interview_change
                     where candidate_id = ${d.candidateId}`),
    );
    expect(row).toEqual({
      source_id: d.interviewId,
      strength: 'medium',
      applied_by: AYESHA,
      reason: 'Defended the design in detail',
    });
  });
});

describe('Scenario: Another workspace', () => {
  // SAFETY: mutation check: removed the workspace filter from assessmentStore.byId -> this test still passed on RLS alone;
  // ALTER POLICY result_tenant_isolation USING (true) as well -> this test failed (W2 previewed W1's assessment)
  it('a preview or an apply of another workspace’s assessment is refused, and nothing is read or written', async () => {
    const d = await daniel();
    const { previewId } = await preview(d);
    const before = await written(d.candidateId);
    await expect(preview(d, AYESHA, w2)).rejects.toBeInstanceOf(ForbiddenError);
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
                 strength, level, item_ids, reason, applied_by, applied_at, ${crypto.randomUUID()}::uuid
          from assessment.interview_change limit 1`),
      ),
    ).rejects.toThrow();
  });
});

describe('Who may preview and apply', () => {
  // SAFETY: mutation check: removed the authorize call from scoreChange.ts `authorised` -> this test failed (the interviewer previewed and applied)
  it('an interviewer with no grant on the job can neither preview nor apply', async () => {
    const d = await daniel();
    const { previewId } = await preview(d);
    const before = await written(d.candidateId);
    await expect(preview(d, LINA)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(apply(d, previewId, { userId: LINA })).rejects.toBeInstanceOf(ForbiddenError);
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
