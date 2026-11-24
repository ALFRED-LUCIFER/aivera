import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { createAiClient, fakeProvider, memoryTokenBudget } from '@credalent/ai';
import type { AssessmentContract } from '@credalent/assessment';
import { createAssessment } from '@credalent/assessment/composition';
import { createAudit } from '@credalent/audit/composition';
import { createCandidates, displayNamesInWorkspace } from '@credalent/candidates/composition';
import { createDb, withWorkspace, type Db } from '@credalent/db';
import type { EvidenceContract, Provenance, Strength } from '@credalent/evidence';
import { createEvidence } from '@credalent/evidence/composition';
import type { IntakeContract } from '@credalent/intake';
import { createApplicationReads, createCandidateJobResolver, createIntake } from '@credalent/intake/composition';
import type { Competency, JobsContract } from '@credalent/jobs';
import { createApprovedRubricReads, createJobs } from '@credalent/jobs/composition';
import type { Role, WorkspaceContext, WorkspacesContract } from '@credalent/workspaces';
import { createWorkspaces } from '@credalent/workspaces/composition';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { receiveConfirmed } from './confirmedBatch.ts';

// AIV-P1-043: the module contracts the candidate profile reads, against real PostgreSQL as the non-owner aivera_app
// role, from seeded data: row-level security, the job scope, applications through intake, evidence through its contract,
// and scores from `assessCandidate` (the formula's 63 up to 83 for Sara, not the design's illustrative 68 up to 84; owner
// decision in modules/assessment/README.md). It does not run the shipped `loadProfile`: a test package may not import
// the app (AGENTS.md 9.4), so `readProfile` below repeats its steps. `loadProfile` itself is proven by its unit test
// (apps/web/src/features/evidence-profile/services/loadProfile.test.ts) and, on a real database, by
// tests/e2e/src/candidate-profile.spec.ts. The modules are built as the app's composition root builds them
// (apps/web/src/server). Synthetic cast only (docs/00-product/personas.md).

const rolesSql = readFileSync(createRequire(import.meta.url).resolve('@credalent/db/sql/roles.sql'), 'utf8');
const dbCli = join(import.meta.dirname, '..', '..', '..', 'packages', 'db', 'src', 'cli.ts');

const ALEX = '0190d4a2-0000-7000-8000-00000000a1e1'; // admin of the demo workspace
const RANA = '0190d4a2-0000-7000-8000-0000000052aa'; // recruiter
const HEAD = '0190d4a2-0000-7000-8000-0000000052bb'; // Head of Engineering, hiring owner of Senior AI Engineer
const LINA = '0190d4a2-0000-7000-8000-0000000052dd'; // interviewer, granted no job
const OMAR = '0190d4a2-0000-7000-8000-0000000052cc'; // admin of Gulf Talent Partners
const NOW = new Date('2026-11-20T09:00:00.000Z');

let container: StartedPostgreSqlContainer;
let admin: Db;
let app: Db;
let workspaces: WorkspacesContract;
let jobs: JobsContract;
let intake: IntakeContract;
let evidence: EvidenceContract;
let assessment: AssessmentContract;
let demo: string;
let gulf: string;
let sae: string; // Senior AI Engineer, rubric approved
let spd: string; // Senior Product Designer, no approved rubric
let gulfJob: string;
let sara: string;
let daniel: string;
let youssef: string; // applied to Senior AI Engineer, not assessed
let maria: string; // Gulf Talent Partners' applicant

const urlFor = (role: string) =>
  `postgres://${role}:local_dev_only@${container.getHost()}:${container.getPort()}/${container.getDatabase()}`;

const as = <T>(userId: string, workspaceId: string, fn: (ctx: WorkspaceContext) => Promise<T>) =>
  workspaces.withWorkspace({ userId }, workspaceId, fn);

/** The steps of loadProfile.ts, in the member's workspace transaction. */
const readProfile = (userId: string, workspaceId: string, candidateId: string, jobId: string) =>
  as(userId, workspaceId, async (ctx) => {
    const found = await jobs.getJob(ctx, jobId);
    if (!found) return ctx.role === 'admin' || ctx.role === 'recruiter' ? 'notFound' : 'forbidden';
    const applicant = (await intake.listApplicationsForJob(ctx, jobId)).find((a) => a.personId === candidateId);
    if (!applicant) return 'notFound';
    const base = { jobTitle: found.title, name: applicant.displayName, stage: applicant.stage };
    const ranking = await assessment.listRanking(ctx, jobId);
    if (ranking.status === 'awaiting_rubric') return { ...base, fit: { status: 'awaiting_rubric' }, explanation: null };
    const row = ranking.rows.find((r) => r.candidateId === candidateId);
    if (!row) return { ...base, fit: { status: 'not_scored' }, explanation: null };
    const latest = await assessment.getLatestAssessment(ctx, candidateId, jobId);
    const explanation = await assessment.explainRanking(ctx, candidateId, jobId);
    return {
      ...base,
      fit: {
        status: 'scored',
        rank: row.rank,
        backedScore: row.backedScore,
        upperBound: row.upperBound,
        meetsNeed: row.meetsNeed,
        competencyCount: row.competencyCount,
        ranked: ranking.rows.length,
        openClaims:
          latest?.rubricVersionId === ranking.rubricVersionId
            ? latest.competencies.filter((c) => c.claimedLevel > c.proven.level).length
            : 0,
      },
      explanation,
    };
  });

// The Senior AI Engineer rubric of the Rubric artboard, version 2: [name, weight, level needed].
const RUBRIC: [string, number, number][] = [
  ['LLM systems in production', 25, 4],
  ['Retrieval and evaluation', 20, 4],
  ['Python service engineering', 15, 3],
  ['Cost and reliability', 15, 2],
  ['Arabic and bilingual NLP', 10, 2],
  ['Product judgement', 15, 3],
];

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
  const applied = createCandidateJobResolver(jobs);
  intake = createIntake(workspaces, createCandidates(workspaces), jobs, displayNamesInWorkspace, audit, () => NOW);
  evidence = createEvidence(workspaces, audit, () => NOW, applied);
  // The fake model answers "{}", which fails the schema, so the explanation is the template ("Summary generated without AI").
  const ai = createAiClient({ provider: fakeProvider(), budget: memoryTokenBudget() });
  assessment = createAssessment(
    workspaces,
    audit,
    jobs,
    () => NOW,
    applied,
    createApplicationReads().candidatesForJob,
    {
      ai,
      approvedRubric: createApprovedRubricReads().approvedRubric,
      evidence: (ctx, candidateId, jobId) => evidence.listEvidenceForCandidate(ctx, candidateId, jobId),
      identifiersOf: async () => ({ names: ['Sara Al Qahtani'], emails: [], phones: [] }),
    },
  );

  const newWorkspace = async (name: string, creatorUserId: string) =>
    (await workspaces.createWorkspace({ name, company: name, hiringFocus: 'AI', synthetic: true, creatorUserId })).id;
  const addMember = (userId: string, role: Role) =>
    withWorkspace(app, demo, (tx) =>
      tx.execute(
        sql`insert into workspaces.member (workspace_id, user_id, role, status) values (${demo}, ${userId}, ${role}, 'active')`,
      ),
    );
  const newJob = (userId: string, workspaceId: string, title: string, hiringOwnerUserId: string | null = null) =>
    as(
      userId,
      workspaceId,
      async (ctx) =>
        (
          await jobs.createJob(ctx, {
            title,
            jobType: 'ai_llm_engineering',
            hiringOwnerUserId,
            description: `${title}, synthetic demo job.`,
            synthetic: true,
          })
        ).id,
    );
  const apply = async (userId: string, workspaceId: string, jobId: string, displayName: string, n: number) =>
    (
      await as(userId, workspaceId, (ctx) =>
        receiveConfirmed(intake, ctx, {
          jobId,
          person: {
            displayName,
            identifiers: [{ type: 'cv_hash', value: String(n).padStart(64, '0') }],
            synthetic: true,
          },
          source: 'linkedin',
          fileIds: [crypto.randomUUID()],
        }),
      )
    ).personId;

  demo = await newWorkspace('Demo hiring team', ALEX);
  gulf = await newWorkspace('Gulf Talent Partners', OMAR);
  await addMember(RANA, 'recruiter');
  await addMember(HEAD, 'hiring_owner');
  await addMember(LINA, 'interviewer');
  sae = await newJob(ALEX, demo, 'Senior AI Engineer', HEAD);
  spd = await newJob(ALEX, demo, 'Senior Product Designer');
  gulfJob = await newJob(OMAR, gulf, 'Senior AI Engineer');

  const competencies: Competency[] = RUBRIC.map(([name, weightPercent, levelNeeded]) => ({
    name,
    evidenceExpected: 'A repository, a document or a reference',
    weightPercent,
    levelNeeded,
    type: 'mandatory',
    origin: 'from_description',
  }));
  const version = await as(ALEX, demo, (ctx) =>
    jobs.saveRubric(ctx, sae, { successStatement: 'Ships reliable work.', competencies }),
  );
  await as(ALEX, demo, (ctx) => jobs.submitRubric(ctx, version.id));
  await as(ALEX, demo, (ctx) => jobs.approveRubric(ctx, version.id));
  const rubric = await withWorkspace(app, demo, (tx) => createApprovedRubricReads().approvedRubric(tx, demo, sae));
  if (!rubric) throw new Error('The Senior AI Engineer rubric was not approved.');

  sara = await apply(ALEX, demo, sae, 'Sara Al Qahtani', 1);
  expect(await apply(ALEX, demo, spd, 'Sara Al Qahtani', 1)).toBe(sara);
  daniel = await apply(ALEX, demo, sae, 'Daniel Novak', 2);
  youssef = await apply(ALEX, demo, sae, 'Youssef Aziz', 3);
  maria = await apply(OMAR, gulf, gulfJob, 'Maria Santos', 4);

  /** One item of the candidate's work for a competency of the Senior AI Engineer rubric, at `level`. */
  const work = (
    candidateId: string,
    competency: string,
    level: number,
    label: string,
    excerpt: string,
    provenance: Provenance,
    strength: Strength,
  ) =>
    as(ALEX, demo, (ctx) =>
      evidence.recordEvidence(ctx, {
        candidateId,
        source: {
          kind: provenance === 'claim' ? 'cv' : 'repository',
          label,
          url: null,
          blobFileId: null,
          capturedAt: NOW,
          checkedAt: provenance === 'corroborated' ? NOW : null,
          checkMethod: provenance === 'corroborated' ? 'Commit history' : null,
        },
        items: [
          {
            excerpt,
            excerptSpan: null,
            provenance,
            strength,
            limit: 'Synthetic evidence for the profile test.',
            competencies: [
              { jobId: sae, competencyId: rubric.competencies.find((c) => c.name === competency)?.id ?? '', level },
            ],
          },
        ],
        synthetic: true,
      }),
    );
  // Sara as the Candidate artboard draws her: proven 5, 5, 3, 3, then two competencies resting on claims of level 4.
  await work(
    sara,
    'LLM systems in production',
    5,
    'merchant-help-assistant',
    'led retrieval and the refusal path',
    'corroborated',
    'strong',
  );
  await work(
    sara,
    'Retrieval and evaluation',
    5,
    'llm-eval-harness',
    'authored 412 of 460 commits',
    'corroborated',
    'strong',
  );
  await work(
    sara,
    'Python service engineering',
    3,
    'fastapi-ml-serve',
    'contract tests on every endpoint',
    'submitted',
    'medium',
  );
  await work(
    sara,
    'Product judgement',
    3,
    'refund-bot-decision',
    'argued against a fully automatic refund bot',
    'corroborated',
    'medium',
  );
  await work(sara, 'Cost and reliability', 4, 'CV, page 2', 'cut cost per request by 40%', 'claim', 'claim');
  await work(sara, 'Arabic and bilingual NLP', 4, 'CV, page 2', 'built a Gulf Arabic evaluation set', 'claim', 'claim');
  await work(
    daniel,
    'LLM systems in production',
    3,
    'support-bot',
    'shipped a support assistant',
    'submitted',
    'medium',
  );
  for (const candidateId of [sara, daniel])
    await as(ALEX, demo, async (ctx) =>
      assessment.assessCandidate(ctx, {
        candidateId,
        jobId: sae,
        rubric: { versionId: rubric.id, competencies: rubric.competencies },
        evidence: await evidence.listEvidenceForCandidate(ctx, candidateId, sae),
      }),
    );
}, 180_000);

afterAll(async () => {
  await app?.$client.end();
  await admin?.$client.end();
  await container?.stop();
});

const saraFit = {
  status: 'scored',
  rank: 1,
  backedScore: 63,
  upperBound: 83,
  meetsNeed: 4,
  competencyCount: 6,
  ranked: 2,
  openClaims: 2,
};

describe("Scenario: Sara's fit", () => {
  it('the recruiter reads her name, stage, score, claim range, needs met, rank and open claims', async () => {
    expect(await readProfile(RANA, demo, sara, sae)).toMatchObject({
      jobTitle: 'Senior AI Engineer',
      name: 'Sara Al Qahtani',
      stage: 'new',
      fit: saraFit,
    });
  });

  it('"Why they are ranked here" is the AIV-P1-033 explanation: numbers from the snapshot, a cited evidence item with its quoted words', async () => {
    const profile = await readProfile(RANA, demo, sara, sae);
    const explanation = typeof profile === 'string' ? null : profile.explanation;
    expect(explanation?.source).toBe('template');
    expect(explanation?.statements.map((s) => s.text)).toEqual([
      'Three competencies carrying 60% of the weight are backed by work that was independently checked.',
      'The cited work behind LLM systems in production is merchant-help-assistant.',
      'Two competencies carrying 25% of the weight still rest on claims: Cost and reliability, and Arabic and bilingual NLP.',
    ]);
    const [cited] = explanation?.statements[1]?.citations ?? [];
    expect(cited).toMatchObject({ label: 'merchant-help-assistant', quote: 'led retrieval and the refusal path' });
    const items = await as(RANA, demo, (ctx) => evidence.listEvidenceForCandidate(ctx, sara, sae));
    expect(items.map((i) => i.id)).toContain(cited?.itemId);
  });

  it('a candidate ranked lower reads their own rank, and an applicant not assessed yet is "not scored"', async () => {
    expect(await readProfile(RANA, demo, daniel, sae)).toMatchObject({ fit: { rank: 2, ranked: 2, backedScore: 15 } });
    expect(await readProfile(RANA, demo, youssef, sae)).toMatchObject({
      name: 'Youssef Aziz',
      fit: { status: 'not_scored' },
      explanation: null,
    });
  });
});

describe('Scenario: Candidate not assessed for this job', () => {
  it('Sara applied to a job with no approved rubric: nothing is assessed and nothing explained', async () => {
    expect(await readProfile(RANA, demo, sara, spd)).toEqual({
      jobTitle: 'Senior Product Designer',
      name: 'Sara Al Qahtani',
      stage: 'new',
      fit: { status: 'awaiting_rubric' },
      explanation: null,
    });
  });
});

describe('Who may open a profile (AGENTS.md 1.3)', () => {
  it("the job's hiring owner, granted the job, reads the same fit", async () => {
    expect(await readProfile(HEAD, demo, sara, sae)).toMatchObject({ name: 'Sara Al Qahtani', fit: saraFit });
  });

  // Three layers in jobs hide the job from her (the repository's jobInScope filter, the job_scope policy and getJob's
  // job.view check), and intake checks candidate.view on the job again. With the policy and the job.view check both
  // removed these tests still passed; only with all three gone did they fail, and then on intake's refusal.
  // SAFETY: mutation check: ALTER POLICY job_scope ON jobs.job USING (true), removed `authorize(ctx, 'job.view', ...)` from getJob and jobInScope from the repository's jobWhere -> this test and the next failed (ForbiddenError from intake's own check, which the app renders as 403)
  it('an interviewer not granted the job gets the 403 state for it and for a job that does not exist', async () => {
    expect(await readProfile(LINA, demo, sara, sae)).toBe('forbidden');
    expect(await readProfile(LINA, demo, sara, crypto.randomUUID())).toBe('forbidden');
  });

  it("a hiring owner granted one job gets the 403 state for another job's candidate", async () => {
    expect(await readProfile(HEAD, demo, sara, spd)).toBe('forbidden');
  });
});

describe('Scenario: Another workspace', () => {
  it("another workspace's candidate id is not found on this workspace's job, like an id nobody has", async () => {
    expect(await readProfile(RANA, demo, maria, sae)).toBe('notFound');
    expect(await readProfile(RANA, demo, crypto.randomUUID(), sae)).toBe('notFound');
  });

  it("Gulf Talent Partners' admin finds neither Sara on their own job nor the demo workspace's job", async () => {
    expect(await readProfile(OMAR, gulf, sara, gulfJob)).toBe('notFound');
    expect(await readProfile(OMAR, gulf, sara, sae)).toBe('notFound');
  });

  // SAFETY: mutation check: ALTER POLICY result_tenant_isolation ON assessment.result USING (true) WITH CHECK (true) -> this test failed (Sara's and Daniel's rows came back)
  it("row-level security alone hides the demo workspace's results from Gulf Talent Partners", async () => {
    expect([
      ...(await withWorkspace(app, gulf, (tx) =>
        tx.execute(sql`select candidate_id from assessment.result where job_id = ${sae}`),
      )),
    ]).toEqual([]);
  });
});
