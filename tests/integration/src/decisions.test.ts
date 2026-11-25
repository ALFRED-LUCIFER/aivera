import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { AssessmentContract, RubricInput } from '@credalent/assessment';
import { createAssessment } from '@credalent/assessment/composition';
import type { AuditContract } from '@credalent/audit';
import { createAudit } from '@credalent/audit/composition';
import { createCandidates, displayNamesInWorkspace } from '@credalent/candidates/composition';
import { createDb, DbQueryError, withWorkspace, type Db } from '@credalent/db';
import type { DecisionsContract } from '@credalent/decisions';
import { createDecisions } from '@credalent/decisions/composition';
import type { EvidenceContract } from '@credalent/evidence';
import { createEvidence } from '@credalent/evidence/composition';
import type { IntakeContract } from '@credalent/intake';
import { createIntake } from '@credalent/intake/composition';
import type { Competency, JobsContract } from '@credalent/jobs';
import { createApprovedRubricReads, createJobs } from '@credalent/jobs/composition';
import { ForbiddenError, type WorkspaceContext, type WorkspacesContract } from '@credalent/workspaces';
import { createWorkspaces } from '@credalent/workspaces/composition';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// AIV-P2-009 acceptance scenarios against real PostgreSQL, connected as the non-owner aivera_app role (ADR-004, ADR-005).
// Synthetic cast only (docs/00-product/personas.md).

const rolesSql = readFileSync(createRequire(import.meta.url).resolve('@credalent/db/sql/roles.sql'), 'utf8');
const dbCli = join(import.meta.dirname, '..', '..', '..', 'packages', 'db', 'src', 'cli.ts');

const ALEX = '0190d4a2-0000-7000-8000-00000000a1e1'; // admin, creator of W1
const ZAID = '0190d4a2-0000-7000-8000-000000002a1d'; // recruiter, not an admin
const HASSAN = '0190d4a2-0000-7000-8000-0000000a55a0'; // hiring owner named on Senior AI Engineer
const FAISAL = '0190d4a2-0000-7000-8000-0000000fa15a'; // hiring owner named on Staff Backend Engineer only
const LINA = '0190d4a2-0000-7000-8000-0000000011aa'; // interviewer granted Senior AI Engineer
const OMAR = '0190d4a2-0000-7000-8000-00000000a6e0'; // admin, creator of W2
const CAMILLE = '0190d4a2-0000-7000-8000-0000000ca111'; // hiring owner named on W2's job
const NOW = new Date('2026-11-17T08:00:00.000Z'); // 17 Nov 2026, the day the pack is prepared
const SHORTLIST = 'Round 2 shortlist: Senior AI Engineer';
const WHY = 'Strong on the two heaviest competencies.';

type JobSetup = { jobId: string; rubric: RubricInput };
/** [competency index, level, proven (strong, corroborated) or a claim]. */
type Shown = [number, number, 'proven' | 'claim'];

let container: StartedPostgreSqlContainer;
let admin: Db;
let app: Db;
let workspaces: WorkspacesContract;
let audit: AuditContract;
let jobs: JobsContract;
let intake: IntakeContract;
let evidence: EvidenceContract;
let assessment: AssessmentContract;
let decisions: DecisionsContract;
let w1: string;
let w2: string;
/** Senior AI Engineer in W1 on approved rubric version 2, owned by Hassan. */
let seniorAi: JobSetup;
let sara: string;
let arjun: string;
let huda: string;
/** Sara's stored assessment when the pack was prepared: 68, up to 84. */
let saraAt68: string;
let shortlist: string;

const urlFor = (role: string) =>
  `postgres://${role}:local_dev_only@${container.getHost()}:${container.getPort()}/${container.getDatabase()}`;

const as = <T>(userId: string, workspaceId: string, fn: (ctx: WorkspaceContext) => Promise<T>) =>
  workspaces.withWorkspace({ userId }, workspaceId, fn);

const competency = (name: string, weightPercent: number): Competency => ({
  name,
  evidenceExpected: 'A repository, a document or a reference',
  weightPercent,
  levelNeeded: 3,
  type: 'mandatory',
  origin: 'from_description',
});

/** A job with each of `versions` saved, sent and approved in turn; returns the last as the assessment's rubric input. */
async function approvedJob(
  workspaceId: string,
  creator: string,
  title: string,
  hiringOwnerUserId: string | null,
  versions: Competency[][],
): Promise<JobSetup> {
  const { id: jobId } = await as(creator, workspaceId, (ctx) =>
    jobs.createJob(ctx, {
      title,
      jobType: 'ai_llm_engineering',
      description: `${title}, synthetic.`,
      synthetic: true,
      hiringOwnerUserId,
    }),
  );
  for (const competencies of versions) {
    const saved = await as(creator, workspaceId, (ctx) =>
      jobs.saveRubric(ctx, jobId, { successStatement: 'Ships reliable AI features.', competencies }),
    );
    const sent = await as(creator, workspaceId, (ctx) => jobs.submitRubric(ctx, saved.id));
    await as(creator, workspaceId, (ctx) => jobs.approveRubric(ctx, sent.id, sent.revision));
  }
  const approved = await withWorkspace(app, workspaceId, (tx) =>
    createApprovedRubricReads().approvedRubric(tx, workspaceId, jobId),
  );
  if (!approved) throw new Error(`${title} has no approved rubric`);
  return { jobId, rubric: { versionId: approved.id, competencies: approved.competencies } };
}

const apply = async (workspaceId: string, creator: string, jobId: string, name: string) =>
  (
    await as(creator, workspaceId, (ctx) =>
      intake.receiveApplication(ctx, {
        jobId,
        person: {
          displayName: name,
          identifiers: [{ type: 'email', value: `${name.toLowerCase().replaceAll(' ', '.')}@example.com` }],
          synthetic: true,
        },
        source: 'careers_page',
      }),
    )
  ).personId;

/** Records one source showing `shown` for the candidate, then assesses them on the job's approved rubric. */
const assess = (workspaceId: string, creator: string, job: JobSetup, candidateId: string, shown: Shown[]) =>
  as(creator, workspaceId, async (ctx) => {
    await evidence.recordEvidence(ctx, {
      candidateId,
      source: {
        kind: 'document',
        label: `Write-up ${crypto.randomUUID()}`,
        url: null,
        blobFileId: null,
        capturedAt: NOW,
        checkedAt: NOW,
        checkMethod: 'Reference call',
      },
      items: shown.map(([index, level, kind]) => ({
        excerpt: `Synthetic work sample ${crypto.randomUUID()}`,
        excerptSpan: null,
        provenance: kind === 'proven' ? 'corroborated' : 'claim',
        strength: kind === 'proven' ? 'strong' : 'supporting',
        limit: 'Synthetic.',
        competencies: [{ jobId: job.jobId, competencyId: job.rubric.competencies[index]?.id ?? '', level }],
      })),
      synthetic: true,
    });
    return assessment.assessCandidate(ctx, {
      candidateId,
      jobId: job.jobId,
      rubric: job.rubric,
      evidence: await evidence.listEvidenceForCandidate(ctx, candidateId, job.jobId),
    });
  });

const count = async (table: string) =>
  Number((await admin.execute<{ n: string }>(sql`select count(*) as n from ${sql.raw(table)}`))[0]?.n);

/** Row counts of everything that could reach a candidate or another module: notifications.* and every other outbox. */
async function sideEffects() {
  const tables = await admin.execute<{ name: string }>(sql`
    select schemaname || '.' || tablename as name from pg_tables
    where schemaname = 'notifications' or (tablename = 'outbox' and schemaname <> 'decisions') order by 1`);
  const counts: Record<string, number> = {};
  for (const { name } of tables) counts[name] = await count(name);
  return counts;
}

const stored = () =>
  Promise.all(['decisions.pack', 'decisions.pack_member', 'decisions.decision', 'decisions.outbox'].map(count));

const decisionAudits = async (candidateId: string) =>
  (await audit.listFor(w1, { type: 'candidate', id: candidateId })).filter((e) => e.action === 'decision.recorded');

const advance = (packId: string, candidateIds: string[]) => ({
  packId,
  decisions: candidateIds.map((candidateId) => ({ candidateId, decision: 'advance' as const, note: WHY })),
});

/** Runs raw SQL in W1 as the app role, past the module, to reach the database's own checks; resolves to its error code. */
const rawInW1 = (query: ReturnType<typeof sql>) =>
  withWorkspace(app, w1, (tx) => tx.execute(query)).then(
    () => 'ok',
    (error: unknown) => (error instanceof DbQueryError ? error.code : String(error)),
  );

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
  intake = createIntake(
    workspaces,
    createCandidates(workspaces, () => NOW),
    jobs,
    displayNamesInWorkspace,
    audit,
    () => NOW,
  );
  evidence = createEvidence(workspaces, audit, () => NOW);
  assessment = createAssessment(workspaces, audit, jobs, () => NOW);
  decisions = createDecisions(workspaces, jobs, assessment, audit, () => NOW);
  const newWorkspace = async (name: string, creatorUserId: string) =>
    (await workspaces.createWorkspace({ name, company: name, hiringFocus: 'AI', synthetic: true, creatorUserId })).id;
  w1 = await newWorkspace('Demo Hiring Co', ALEX);
  w2 = await newWorkspace('Gulf Talent Partners', OMAR);
  await withWorkspace(app, w1, (tx) =>
    tx.execute(
      sql`insert into workspaces.member (workspace_id, user_id, role, status) values
        (${w1}, ${ZAID}, 'recruiter', 'active'), (${w1}, ${HASSAN}, 'hiring_owner', 'active'),
        (${w1}, ${FAISAL}, 'hiring_owner', 'active'), (${w1}, ${LINA}, 'interviewer', 'active')`,
    ),
  );

  // Background: "Senior AI Engineer" on approved rubric version 2, owned by Hassan, with three assessed applicants.
  seniorAi = await approvedJob(w1, ALEX, 'Senior AI Engineer', HASSAN, [
    [competency('Prompt engineering', 50), competency('Cost and reliability', 50)],
    [
      competency('LLM systems in production', 40),
      competency('Retrieval and evaluation', 40),
      competency('Arabic and bilingual NLP', 20),
    ],
  ]);
  await as(ALEX, w1, (ctx) => workspaces.grantJobAccess(ctx, { userId: LINA, jobId: seniorAi.jobId }));
  sara = await apply(w1, ALEX, seniorAi.jobId, 'Sara Al Qahtani');
  arjun = await apply(w1, ALEX, seniorAi.jobId, 'Arjun Menon');
  huda = await apply(w1, ALEX, seniorAi.jobId, 'Huda Al Mansoori');
  // Given Sara Al Qahtani's backed score is 68 "up to 84": 40 + 24 + 4 proven, and a claim worth 16 more.
  const first = await assess(w1, ALEX, seniorAi, sara, [
    [0, 5, 'proven'],
    [1, 3, 'proven'],
    [2, 1, 'proven'],
    [2, 5, 'claim'],
  ]);
  expect([first.backedScore, first.upperBound]).toEqual([68, 84]);
  saraAt68 = first.id;
  // Arjun Menon 64 up to 76; Huda Al Mansoori 60 up to 76.
  await assess(w1, ALEX, seniorAi, arjun, [
    [0, 4, 'proven'],
    [1, 4, 'proven'],
    [2, 3, 'claim'],
  ]);
  await assess(w1, ALEX, seniorAi, huda, [
    [0, 4, 'proven'],
    [1, 3, 'proven'],
    [2, 1, 'proven'],
    [2, 5, 'claim'],
  ]);
}, 180_000);

afterAll(async () => {
  await app?.$client.end();
  await admin?.$client.end();
  await container?.stop();
});

describe('Migrations', () => {
  it('decisions tables are owned by aivera_migrator with row-level security enabled and forced', async () => {
    const tables = await admin.execute<{ name: string; owner: string; rls: boolean; forced: boolean }>(sql`
      select t.tablename as name, t.tableowner as owner, c.relrowsecurity as rls, c.relforcerowsecurity as forced
      from pg_tables t join pg_class c on c.oid = format('%I.%I', t.schemaname, t.tablename)::regclass
      where t.schemaname = 'decisions' order by name`);
    expect([...tables]).toEqual(
      ['decision', 'outbox', 'pack', 'pack_member'].map((name) => ({
        name,
        owner: 'aivera_migrator',
        rls: true,
        forced: true,
      })),
    );
  });

  it('applying the migrations again is a no-op', async () => {
    const applied = await count('migrations.decisions');
    expect(applied).toBe(2);
    execFileSync(process.execPath, [dbCli, 'migrate'], {
      env: { ...process.env, DATABASE_MIGRATOR_URL: urlFor('aivera_migrator') },
    });
    expect(await count('migrations.decisions')).toBe(applied);
  });
});

describe('Scenario: Create a pack with a snapshot', () => {
  // SAFETY: mutation check: removed publishPackReady from createPack -> this test failed (no PackReady.v1)
  it('a recruiter creates a pack for "Senior AI Engineer" with Sara, Arjun and Huda: rubric version 2 and each snapshot', async () => {
    ({ packId: shortlist } = await as(ZAID, w1, (ctx) =>
      decisions.createPack(ctx, {
        jobId: seniorAi.jobId,
        name: SHORTLIST,
        members: [{ candidateId: sara }, { candidateId: arjun }, { candidateId: huda }],
      }),
    ));
    const pack = await as(ZAID, w1, (ctx) => decisions.getPack(ctx, shortlist));
    expect(pack).toMatchObject({
      jobId: seniorAi.jobId,
      rubricVersionId: seniorAi.rubric.versionId,
      name: SHORTLIST,
      preparedBy: ZAID,
      preparedAt: NOW,
      status: 'ready',
      decisions: [],
    });
    expect((await as(ZAID, w1, (ctx) => jobs.getApprovedRubric(ctx, seniorAi.jobId)))?.version).toBe(2);
    expect(pack?.members.map((m) => [m.candidateId, m.backedScore, m.upperBound])).toEqual([
      [sara, 68, 84],
      [arjun, 64, 76],
      [huda, 60, 76],
    ]);
    expect(pack?.members[0]?.assessmentId).toBe(saraAt68);
    const events = await withWorkspace(app, w1, (tx) =>
      tx.execute<{ type: string; payload: unknown }>(
        sql`select type, payload from decisions.outbox where payload->>'packId' = ${shortlist}`,
      ),
    );
    expect([...events]).toEqual([{ type: 'PackReady.v1', payload: { packId: shortlist, jobId: seniorAi.jobId } }]);
  });

  it("a later change to Sara's score does not change the snapshot in the pack", async () => {
    // Her Arabic work is confirmed: the claim becomes proven, 84 backed.
    const later = await assess(w1, ALEX, seniorAi, sara, [[2, 5, 'proven']]);
    expect([later.backedScore, later.id === saraAt68]).toEqual([84, false]);
    const [snapshot] = (await as(ZAID, w1, (ctx) => decisions.getPack(ctx, shortlist)))?.members ?? [];
    expect(snapshot).toMatchObject({ candidateId: sara, assessmentId: saraAt68, backedScore: 68, upperBound: 84 });
  });

  // SAFETY: mutation check: GRANT UPDATE ON decisions.pack_member TO aivera_app -> this test failed ('ok', snapshot rewritten)
  it('the database refuses the app role any rewrite of a snapshot', async () => {
    expect(await rawInW1(sql`update decisions.pack_member set backed_score = 84 where pack_id = ${shortlist}`)).toBe(
      '42501',
    );
  });

  // SAFETY: mutation check: GRANT DELETE ON decisions.pack_member TO aivera_app -> this test failed ('ok', members deleted)
  it('the database refuses the app role the removal of a pack member', async () => {
    expect(await rawInW1(sql`delete from decisions.pack_member where pack_id = ${shortlist}`)).toBe('42501');
  });

  // SAFETY: mutation check: GRANT UPDATE ON decisions.pack TO aivera_app -> this test failed ('ok' twice, pack moved)
  it('the database refuses the app role a move of a pack to another job or rubric version', async () => {
    expect(await rawInW1(sql`update decisions.pack set job_id = gen_random_uuid() where id = ${shortlist}`)).toBe(
      '42501',
    );
    expect(
      await rawInW1(sql`update decisions.pack set rubric_version_id = gen_random_uuid() where id = ${shortlist}`),
    ).toBe('42501');
  });

  it('a candidate with no assessment on the approved rubric, or no approved rubric, is refused and nothing is stored', async () => {
    const before = await stored();
    const daniel = await apply(w1, ALEX, seniorAi.jobId, 'Daniel Novak');
    await expect(
      as(ZAID, w1, (ctx) =>
        decisions.createPack(ctx, { jobId: seniorAi.jobId, name: SHORTLIST, members: [{ candidateId: daniel }] }),
      ),
    ).rejects.toMatchObject({ code: 'candidate_not_assessed' });
    const { id: designer } = await as(ALEX, w1, (ctx) =>
      jobs.createJob(ctx, {
        title: 'Senior Product Designer',
        jobType: 'ai_llm_engineering',
        description: 'Synthetic.',
        synthetic: true,
      }),
    );
    await expect(
      as(ZAID, w1, (ctx) =>
        decisions.createPack(ctx, { jobId: designer, name: SHORTLIST, members: [{ candidateId: sara }] }),
      ),
    ).rejects.toMatchObject({ code: 'rubric_not_approved' });
    expect(await stored()).toEqual(before);
  });

  it('the database refuses an unknown status, a score above its upper bound and a member of no pack', async () => {
    expect(
      await rawInW1(sql`insert into decisions.pack (id, workspace_id, job_id, rubric_version_id, name, prepared_by,
        prepared_at, status) values (gen_random_uuid(), ${w1}, gen_random_uuid(), gen_random_uuid(), 'Synthetic',
        ${ZAID}, now(), 'shared')`),
    ).toBe('23514');
    for (const [packId, backed, code] of [
      [shortlist, 90, '23514'],
      [crypto.randomUUID(), 68, '23503'],
    ] as const)
      expect(
        await rawInW1(sql`insert into decisions.pack_member (workspace_id, pack_id, candidate_id, assessment_id,
          backed_score, upper_bound, position) values (${w1}, ${packId}, gen_random_uuid(), gen_random_uuid(),
          ${backed}, 84, 7)`),
      ).toBe(code);
  });
});

describe('Scenario: Only the authorised hiring owner decides', () => {
  // SAFETY: mutation check: removed the mayDecide check from recordDecisions -> this test failed (Zaid's decisions stored)
  it('a recruiter without hiring owner authority on this job calls recordDecisions: 403 and nothing is stored', async () => {
    const before = [await stored(), (await decisionAudits(sara)).length];
    const all = advance(shortlist, [sara, arjun, huda]);
    await expect(as(ZAID, w1, (ctx) => decisions.recordDecisions(ctx, all))).rejects.toThrow(ForbiddenError);
    // Nor the admin, nor a hiring owner who owns another job, nor an interviewer on this one.
    await expect(as(ALEX, w1, (ctx) => decisions.recordDecisions(ctx, all))).rejects.toThrow(ForbiddenError);
    await expect(as(LINA, w1, (ctx) => decisions.recordDecisions(ctx, all))).rejects.toThrow(ForbiddenError);
    await expect(as(FAISAL, w1, (ctx) => decisions.recordDecisions(ctx, all))).rejects.toMatchObject({
      code: 'pack_not_found',
    });
    expect([await stored(), (await decisionAudits(sara)).length]).toEqual(before);
    expect((await as(ZAID, w1, (ctx) => decisions.getPack(ctx, shortlist)))?.status).toBe('ready');
  });
});

describe('Scenario: A candidate appears once', () => {
  it('Sara is added to the same pack twice: the second add is ignored and her snapshot stays', async () => {
    expect(await as(ZAID, w1, (ctx) => decisions.addMembers(ctx, shortlist, [{ candidateId: sara }]))).toEqual({
      added: 0,
    });
    const members = (await as(ZAID, w1, (ctx) => decisions.getPack(ctx, shortlist)))?.members ?? [];
    expect(members.map((m) => m.candidateId)).toEqual([sara, arjun, huda]);
    // Her latest assessment is 84 by now; the add did not retake the snapshot.
    expect(members[0]).toMatchObject({ assessmentId: saraAt68, backedScore: 68 });
  });

  // SAFETY: mutation check: ALTER TABLE decisions.pack_member DROP CONSTRAINT pack_member_pkey CASCADE -> this test failed ('ok', Sara twice)
  it('the database refuses a second row for Sara in the pack', async () => {
    expect(
      await rawInW1(sql`insert into decisions.pack_member (workspace_id, pack_id, candidate_id, assessment_id,
        backed_score, upper_bound, position) values (${w1}, ${shortlist}, ${sara}, gen_random_uuid(), 84, 84, 9)`),
    ).toBe('23505');
  });
});

describe('Scenario: Record decisions emits one event', () => {
  let effectsBefore: Awaited<ReturnType<typeof sideEffects>>;

  beforeAll(async () => {
    effectsBefore = await sideEffects();
    await as(HASSAN, w1, (ctx) => decisions.recordDecisions(ctx, advance(shortlist, [sara, arjun, huda])));
  });

  // SAFETY: mutation check: removed the auditDecision loop from recordDecisions -> this test failed (no decision.recorded entry)
  it('the hiring owner records "advance" for all three: three decisions with the hiring owner and time, each audited', async () => {
    const pack = await as(HASSAN, w1, (ctx) => decisions.getPack(ctx, shortlist));
    expect(pack?.status).toBe('decided');
    expect(pack?.decisions).toHaveLength(3);
    expect(new Set(pack?.decisions.map((d) => d.candidateId))).toEqual(new Set([sara, arjun, huda]));
    for (const d of pack?.decisions ?? [])
      expect(d).toMatchObject({ decision: 'advance', decidedBy: HASSAN, decidedAt: NOW, note: WHY });
    for (const candidateId of [sara, arjun, huda])
      expect(await decisionAudits(candidateId)).toEqual([
        expect.objectContaining({
          actor: { type: 'user', id: HASSAN },
          note: WHY,
          after: { packId: shortlist, jobId: seniorAi.jobId, decision: 'advance' },
        }),
      ]);
  });

  // SAFETY: mutation check: removed publishDecisionsRecorded from recordDecisions -> this test failed (no DecisionsRecorded.v1)
  it('one "DecisionsRecorded" event is written to the outbox', async () => {
    const events = await withWorkspace(app, w1, (tx) =>
      tx.execute<{ payload: unknown }>(
        sql`select payload from decisions.outbox where type = 'DecisionsRecorded.v1' and payload->>'packId' = ${shortlist}`,
      ),
    );
    expect([...events]).toEqual([{ payload: { packId: shortlist, jobId: seniorAi.jobId } }]);
  });

  it('no notification to any candidate is enqueued: notifications.* and every other outbox are unchanged', async () => {
    expect(Object.keys(effectsBefore)).toEqual(expect.arrayContaining(['notifications.outbox', 'intake.outbox']));
    expect(await sideEffects()).toEqual(effectsBefore);
  });

  it('decisions are recorded once: a second record and a late member are refused', async () => {
    const before = await stored();
    await expect(
      as(HASSAN, w1, (ctx) => decisions.recordDecisions(ctx, advance(shortlist, [sara, arjun, huda]))),
    ).rejects.toMatchObject({ code: 'pack_decided' });
    await expect(
      as(ZAID, w1, (ctx) => decisions.addMembers(ctx, shortlist, [{ candidateId: crypto.randomUUID() }])),
    ).rejects.toMatchObject({ code: 'pack_decided' });
    expect(await stored()).toEqual(before);
  });

  // SAFETY: mutation check: GRANT UPDATE, DELETE ON decisions.decision TO aivera_app -> this test failed ('ok' twice)
  it('the database keeps a recorded decision: the app role can neither change nor delete it, nor decide on a non-member', async () => {
    expect(await rawInW1(sql`update decisions.decision set decision = 'hold' where pack_id = ${shortlist}`)).toBe(
      '42501',
    );
    expect(await rawInW1(sql`delete from decisions.decision where pack_id = ${shortlist}`)).toBe('42501');
    expect(
      await rawInW1(sql`insert into decisions.decision (workspace_id, pack_id, candidate_id, decision, decided_by,
        decided_at, note) values (${w1}, ${shortlist}, gen_random_uuid(), 'advance', ${HASSAN}, now(), 'Synthetic')`),
    ).toBe('23503');
  });

  it('a rolled-back record writes no decision, event or audit entry (same transaction), and every member needs one', async () => {
    const { packId } = await as(ZAID, w1, (ctx) =>
      decisions.createPack(ctx, { jobId: seniorAi.jobId, name: 'Round 3', members: [{ candidateId: arjun }] }),
    );
    const before = [await stored(), (await decisionAudits(arjun)).length];
    await expect(
      as(HASSAN, w1, async (ctx) => {
        await decisions.recordDecisions(ctx, advance(packId, [arjun]));
        throw new Error('rolled back');
      }),
    ).rejects.toThrow('rolled back');
    await expect(
      as(HASSAN, w1, (ctx) => decisions.recordDecisions(ctx, advance(packId, [arjun, sara]))),
    ).rejects.toMatchObject({ code: 'decisions_incomplete' });
    expect([await stored(), (await decisionAudits(arjun)).length]).toEqual(before);
  });
});

describe('Job scope: hiring owners and interviewers reach only granted jobs', () => {
  // The jobs module's job-scope row-level security hides an ungranted job, so its packs read as absent (not a 403).
  // SAFETY: mutation check: made visible() keep a pack whose job is hidden from the context -> this test failed (Faisal's read of the Senior AI Engineer pack was no longer null)
  it('a hiring owner reads the pack of the job they own and none of another job; an interviewer reads no pack', async () => {
    const backend = await approvedJob(w1, ALEX, 'Staff Backend Engineer', FAISAL, [
      [competency('Distributed systems', 100)],
    ]);
    const rana = await apply(w1, ALEX, backend.jobId, 'Rana Khoury');
    await assess(w1, ALEX, backend, rana, [[0, 4, 'proven']]);
    const { packId: other } = await as(ZAID, w1, (ctx) =>
      decisions.createPack(ctx, { jobId: backend.jobId, name: 'Shortlist', members: [{ candidateId: rana }] }),
    );
    expect((await as(FAISAL, w1, (ctx) => decisions.getPack(ctx, other)))?.id).toBe(other);
    expect(await as(FAISAL, w1, (ctx) => decisions.getPack(ctx, shortlist))).toBeNull();
    expect(await as(HASSAN, w1, (ctx) => decisions.getPack(ctx, other))).toBeNull();
    await expect(as(LINA, w1, (ctx) => decisions.getPack(ctx, shortlist))).rejects.toThrow(ForbiddenError);
    // Neither may prepare a pack, on their own job or any other.
    for (const [userId, jobId] of [
      [FAISAL, backend.jobId],
      [HASSAN, seniorAi.jobId],
      [LINA, seniorAi.jobId],
    ] as const)
      await expect(
        as(userId, w1, (ctx) =>
          decisions.createPack(ctx, { jobId, name: 'Shortlist', members: [{ candidateId: rana }] }),
        ),
      ).rejects.toThrow(ForbiddenError);
    await expect(as(FAISAL, w1, (ctx) => decisions.addMembers(ctx, other, [{ candidateId: rana }]))).rejects.toThrow(
      ForbiddenError,
    );
    // The owner of Staff Backend Engineer decides on its pack.
    await as(FAISAL, w1, (ctx) => decisions.recordDecisions(ctx, advance(other, [rana])));
    expect((await as(ZAID, w1, (ctx) => decisions.getPack(ctx, other)))?.status).toBe('decided');
  });
});

describe('Scenario: Workspace isolation', () => {
  let w2Pack: string;
  let w2Job: JobSetup;
  let karim: string;

  beforeAll(async () => {
    await withWorkspace(app, w2, (tx) =>
      tx.execute(
        sql`insert into workspaces.member (workspace_id, user_id, role, status) values (${w2}, ${CAMILLE}, 'hiring_owner', 'active')`,
      ),
    );
    w2Job = await approvedJob(w2, OMAR, 'Senior AI Engineer', CAMILLE, [[competency('Retrieval and evaluation', 100)]]);
    karim = await apply(w2, OMAR, w2Job.jobId, 'Karim Nasser');
    await assess(w2, OMAR, w2Job, karim, [[0, 3, 'proven']]);
    ({ packId: w2Pack } = await as(OMAR, w2, (ctx) =>
      decisions.createPack(ctx, { jobId: w2Job.jobId, name: SHORTLIST, members: [{ candidateId: karim }] }),
    ));
    await as(CAMILLE, w2, (ctx) => decisions.recordDecisions(ctx, advance(w2Pack, [karim])));
  });

  it('members of W1 cannot read, extend or decide the W2 pack, nor build one on a W2 job', async () => {
    const before = await stored();
    expect(await as(ALEX, w1, (ctx) => decisions.getPack(ctx, w2Pack))).toBeNull();
    await expect(
      as(ALEX, w1, (ctx) => decisions.addMembers(ctx, w2Pack, [{ candidateId: sara }])),
    ).rejects.toMatchObject({ code: 'pack_not_found' });
    await expect(
      as(HASSAN, w1, (ctx) => decisions.recordDecisions(ctx, advance(w2Pack, [karim]))),
    ).rejects.toMatchObject({ code: 'pack_not_found' });
    await expect(
      as(ALEX, w1, (ctx) =>
        decisions.createPack(ctx, { jobId: w2Job.jobId, name: SHORTLIST, members: [{ candidateId: karim }] }),
      ),
    ).rejects.toMatchObject({ code: 'job_not_found' });
    expect(await stored()).toEqual(before);
  });

  // SAFETY: mutation check: CREATE POLICY leak ON decisions.pack USING (true) -> this test failed (W2 rows read in W1 and with no workspace)
  // SAFETY: mutation check: ALTER TABLE decisions.pack DISABLE ROW LEVEL SECURITY -> this test failed (W2 rows read)
  it('RLS alone: in W1 with no WHERE clause only W1 rows come back, and a query without a workspace returns no rows', async () => {
    for (const table of ['pack', 'pack_member', 'decision', 'outbox']) {
      const from = sql`decisions.${sql.identifier(table)}`;
      const inW1 = await withWorkspace(app, w1, (tx) =>
        tx.execute<{ workspace_id: string }>(sql`select workspace_id from ${from}`),
      );
      expect(new Set(inW1.map((r) => r.workspace_id)), table).toEqual(new Set([w1]));
      expect(await app.execute(sql`select 1 from ${from}`), table).toHaveLength(0);
    }
  });
});

// AIV-P2-010: the ranking reads the job's packs for "Add to decision pack" and "In shortlist pack".
describe('listPacks', () => {
  it("lists the job's packs, newest first, each with its status and members in pack order", async () => {
    const { packId } = await as(ZAID, w1, (ctx) =>
      decisions.createPack(ctx, {
        jobId: seniorAi.jobId,
        name: 'Round 3 shortlist',
        members: [{ candidateId: arjun }, { candidateId: sara }],
      }),
    );
    const packs = await as(ZAID, w1, (ctx) => decisions.listPacks(ctx, seniorAi.jobId));
    expect(packs.find((p) => p.id === packId)).toEqual({
      id: packId,
      name: 'Round 3 shortlist',
      status: 'ready',
      candidateIds: [arjun, sara],
    });
    expect(packs.map((p) => p.id)).toContain(shortlist);
    // The hiring owner named on the job reads them too (pack.view).
    expect((await as(HASSAN, w1, (ctx) => decisions.listPacks(ctx, seniorAi.jobId))).map((p) => p.id)).toContain(
      packId,
    );
  });

  it('an interviewer is refused; a hiring owner not granted the job, and another workspace’s member, find no such job', async () => {
    await expect(as(LINA, w1, (ctx) => decisions.listPacks(ctx, seniorAi.jobId))).rejects.toThrow(ForbiddenError);
    await expect(as(FAISAL, w1, (ctx) => decisions.listPacks(ctx, seniorAi.jobId))).rejects.toMatchObject({
      code: 'job_not_found',
    });
    await expect(as(OMAR, w2, (ctx) => decisions.listPacks(ctx, seniorAi.jobId))).rejects.toMatchObject({
      code: 'job_not_found',
    });
  });
});
