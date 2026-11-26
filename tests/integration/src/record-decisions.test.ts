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
import { createDb, withWorkspace, type Db, type Envelope } from '@credalent/db';
import { createConsumer, type Delivery } from '@credalent/db/consumer';
import { DecisionsRecordedV1, type DecisionsContract } from '@credalent/decisions';
import { createDecisions, readDecisionsAsSystem } from '@credalent/decisions/composition';
import type { EvidenceContract } from '@credalent/evidence';
import { createEvidence } from '@credalent/evidence/composition';
import type { IntakeContract } from '@credalent/intake';
import { createDecisionStageHandler, createIntake } from '@credalent/intake/composition';
import type { JobsContract } from '@credalent/jobs';
import { createApprovedRubricReads, createJobs } from '@credalent/jobs/composition';
import { ForbiddenError, type WorkspaceContext, type WorkspacesContract } from '@credalent/workspaces';
import { createWorkspaces } from '@credalent/workspaces/composition';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// AIV-P2-012 acceptance scenarios against real PostgreSQL, as the non-owner aivera_app role (ADR-004, ADR-005): the
// hiring owner records the pack's decisions, and intake's DecisionsRecorded.v1 consumer, wired as apps/backend/worker
// wires it, moves the stages once. Synthetic cast only (docs/00-product/personas.md).

const rolesSql = readFileSync(createRequire(import.meta.url).resolve('@credalent/db/sql/roles.sql'), 'utf8');
const dbCli = join(import.meta.dirname, '..', '..', '..', 'packages', 'db', 'src', 'cli.ts');

const ALEX = '0190d4a2-0000-7000-8000-00000000a1e1'; // admin, creator of W1
const ZAID = '0190d4a2-0000-7000-8000-000000002a1d'; // recruiter without hiring owner authority
const HASSAN = '0190d4a2-0000-7000-8000-0000000a55a0'; // Head of Engineering, hiring owner named on Senior AI Engineer
const FAISAL = '0190d4a2-0000-7000-8000-0000000fa15a'; // hiring owner granted only another job
const LINA = '0190d4a2-0000-7000-8000-0000000011aa'; // interviewer granted Senior AI Engineer
const OMAR = '0190d4a2-0000-7000-8000-00000000a6e0'; // admin, creator of W2
const NOW = new Date('2026-11-18T09:30:00.000Z');
const WHY = 'Strong on the two heaviest competencies; probe cost in Round 2.';

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
let jobId: string;
let sara: string;
let arjun: string;
let huda: string;
let packId: string;

const urlFor = (role: string) =>
  `postgres://${role}:local_dev_only@${container.getHost()}:${container.getPort()}/${container.getDatabase()}`;
const as = <T>(userId: string, workspaceId: string, fn: (ctx: WorkspaceContext) => Promise<T>) =>
  workspaces.withWorkspace({ userId }, workspaceId, fn);
const count = async (table: string) =>
  Number((await admin.execute<{ n: string }>(sql`select count(*) as n from ${sql.raw(table)}`))[0]?.n);

/** Everything that could reach a candidate: notifications.* and every outbox but the decisions one. */
async function sideEffects() {
  const tables = await admin.execute<{ name: string }>(sql`
    select schemaname || '.' || tablename as name from pg_tables
    where schemaname = 'notifications' or (tablename = 'outbox' and schemaname <> 'decisions') order by 1`);
  const counts: Record<string, number> = {};
  for (const { name } of tables) counts[name] = await count(name);
  return counts;
}

const stageOf = async (personId: string) =>
  (await as(ALEX, w1, (ctx) => intake.listApplicationsForJob(ctx, jobId))).find((a) => a.personId === personId)?.stage;
const stageAudits = () =>
  admin.execute<{ actor_type: string; actor_id: string; note: string; before: unknown; after: unknown }>(
    sql`select actor_type, actor_id, note, before, after from audit.entry
      where action = 'application.stage_changed' order by occurred_at, id`,
  );

/** The DecisionsRecorded.v1 the record wrote, as the relay sends it. */
async function recorded(): Promise<Envelope> {
  const [row] = await admin.execute<{ id: string; payload: unknown; occurred_at: Date }>(
    sql`select id, payload, occurred_at from decisions.outbox where type = 'DecisionsRecorded.v1'`,
  );
  if (!row) throw new Error('No DecisionsRecorded.v1 in decisions.outbox');
  const occurredAt = new Date(row.occurred_at).toISOString();
  return {
    id: row.id,
    type: 'DecisionsRecorded.v1',
    workspaceId: w1,
    payload: row.payload,
    occurredAt,
    correlationId: null,
  };
}

/** Delivers the envelope as Service Bus would, to the consumer as apps/backend/worker wires it; returns the settlement. */
async function deliver(envelope: Envelope) {
  const settled: string[] = [];
  const delivery: Delivery = {
    body: envelope,
    deliveryCount: 1,
    complete: async () => void settled.push('complete'),
    abandon: async () => void settled.push('abandon'),
    deadLetter: async (reason) => void settled.push(`deadLetter: ${reason}`),
  };
  const handler = createDecisionStageHandler({ event: DecisionsRecordedV1, decisionsOf: readDecisionsAsSystem, audit });
  await createConsumer({ db: app, queue: 'assessment', handlers: [handler], now: () => NOW }).handle(delivery);
  return settled;
}

beforeAll(async () => {
  container = await new PostgreSqlContainer('pgvector/pgvector:pg17').withDatabase('aivera').start();
  admin = createDb(container.getConnectionUri(), { max: 1 });
  await admin.$client.unsafe(rolesSql);
  execFileSync(process.execPath, [dbCli, 'migrate'], {
    env: { ...process.env, DATABASE_MIGRATOR_URL: urlFor('aivera_migrator') },
  });
  app = createDb(urlFor('aivera_app'), { max: 1 });
  audit = createAudit(app, () => NOW);
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

  // Background: "Senior AI Engineer" owned by the Head of Engineering, and "Round 2 shortlist: Senior AI Engineer".
  ({ id: jobId } = await as(ALEX, w1, (ctx) =>
    jobs.createJob(ctx, {
      title: 'Senior AI Engineer',
      jobType: 'ai_llm_engineering',
      description: 'Senior AI Engineer, synthetic.',
      synthetic: true,
      hiringOwnerUserId: HASSAN,
    }),
  ));
  const { id: otherJob } = await as(ALEX, w1, (ctx) =>
    jobs.createJob(ctx, {
      title: 'Platform Engineer',
      jobType: 'ai_llm_engineering',
      description: 'Synthetic.',
      synthetic: true,
    }),
  );
  await as(ALEX, w1, async (ctx) => {
    await workspaces.grantJobAccess(ctx, { userId: LINA, jobId });
    await workspaces.grantJobAccess(ctx, { userId: FAISAL, jobId: otherJob });
    const saved = await jobs.saveRubric(ctx, jobId, {
      successStatement: 'Ships reliable AI features.',
      competencies: [
        {
          name: 'LLM systems in production',
          evidenceExpected: 'A repository',
          weightPercent: 100,
          levelNeeded: 3,
          type: 'mandatory',
          origin: 'from_description',
        },
      ],
    });
    const sent = await jobs.submitRubric(ctx, saved.id);
    await jobs.approveRubric(ctx, sent.id, sent.revision);
  });
  const rubric = await withWorkspace(app, w1, (tx) => createApprovedRubricReads().approvedRubric(tx, w1, jobId));
  if (!rubric) throw new Error('No approved rubric');
  const applyAndAssess = (name: string) =>
    as(ALEX, w1, async (ctx) => {
      const { personId } = await intake.receiveApplication(ctx, {
        jobId,
        person: {
          displayName: name,
          identifiers: [{ type: 'email', value: `${name.toLowerCase().replaceAll(' ', '.')}@example.com` }],
          synthetic: true,
        },
        source: 'careers_page',
      });
      await evidence.recordEvidence(ctx, {
        candidateId: personId,
        source: {
          kind: 'document',
          label: 'Write-up',
          url: null,
          blobFileId: null,
          capturedAt: NOW,
          checkedAt: NOW,
          checkMethod: 'Reference call',
        },
        items: [
          {
            excerpt: 'Synthetic work sample',
            excerptSpan: null,
            provenance: 'corroborated',
            strength: 'strong',
            limit: 'Synthetic.',
            competencies: [{ jobId, competencyId: rubric.competencies[0]?.id ?? '', level: 4 }],
          },
        ],
        synthetic: true,
      });
      await assessment.assessCandidate(ctx, {
        candidateId: personId,
        jobId,
        rubric: { versionId: rubric.id, competencies: rubric.competencies },
        evidence: await evidence.listEvidenceForCandidate(ctx, personId, jobId),
      });
      return personId;
    });
  sara = await applyAndAssess('Sara Al Qahtani');
  arjun = await applyAndAssess('Arjun Menon');
  huda = await applyAndAssess('Huda Al Mansoori');
  ({ packId } = await as(ZAID, w1, (ctx) =>
    decisions.createPack(ctx, {
      jobId,
      name: 'Round 2 shortlist: Senior AI Engineer',
      members: [{ candidateId: sara }, { candidateId: arjun }, { candidateId: huda }],
    }),
  ));
}, 180_000);

afterAll(async () => {
  await app?.$client.end();
  await admin?.$client.end();
  await container?.stop();
});

const choices = {
  get decisions() {
    return [
      { candidateId: sara, decision: 'advance' as const, note: WHY },
      { candidateId: arjun, decision: 'do_not_advance' as const, note: WHY },
      { candidateId: huda, decision: 'hold' as const, note: WHY },
    ];
  },
};

describe('Scenario: Only the authorised hiring owner', () => {
  // SAFETY: mutation check: removed `if (!mayDecide(ctx, job)) throw new ForbiddenError()` from recordDecisions -> this test failed (Zaid's decisions stored)
  it('a recruiter and an interviewer get 403, a hiring owner not granted the job and another workspace find no pack; nothing is stored', async () => {
    const input = { packId, decisions: choices.decisions };
    await expect(as(ZAID, w1, (ctx) => decisions.recordDecisions(ctx, input))).rejects.toThrow(ForbiddenError);
    await expect(as(LINA, w1, (ctx) => decisions.recordDecisions(ctx, input))).rejects.toThrow(ForbiddenError);
    await expect(as(FAISAL, w1, (ctx) => decisions.recordDecisions(ctx, input))).rejects.toMatchObject({
      code: 'pack_not_found',
    });
    await expect(as(OMAR, w2, (ctx) => decisions.recordDecisions(ctx, input))).rejects.toMatchObject({
      code: 'pack_not_found',
    });
    expect([
      await count('decisions.decision'),
      await count("decisions.outbox where type = 'DecisionsRecorded.v1'"),
    ]).toEqual([0, 0]);
    // The page's read-only controls: only the hiring owner named on the job may decide.
    expect((await as(ZAID, w1, (ctx) => decisions.getPack(ctx, packId)))?.mayDecide).toBe(false);
    expect((await as(HASSAN, w1, (ctx) => decisions.getPack(ctx, packId)))?.mayDecide).toBe(true);
  });
});

describe('Scenario: Record decisions, and No candidate is contacted', () => {
  let before: Awaited<ReturnType<typeof sideEffects>>;
  beforeAll(async () => {
    before = await sideEffects();
    await as(HASSAN, w1, (ctx) => decisions.recordDecisions(ctx, { packId, decisions: choices.decisions }));
  });

  it('three decisions stored with the hiring owner and the time, each audited with the decision', async () => {
    const entries = await admin.execute<{ actor_id: string; occurred_at: Date; after: { decision: string } }>(
      sql`select actor_id, occurred_at, after from audit.entry where action = 'decision.recorded' order by subject_id`,
    );
    expect(entries).toHaveLength(3);
    for (const e of entries) expect([e.actor_id, new Date(e.occurred_at).getTime()]).toEqual([HASSAN, NOW.getTime()]);
    expect(entries.map((e) => e.after.decision).toSorted()).toEqual(['advance', 'do_not_advance', 'hold']);
  });

  // SAFETY: mutation check: the stage handler also enqueued ApplicationReceived.v1 to intake.outbox -> this test failed (intake.outbox changed)
  // SAFETY: mutation check: a random inbox consumer name and no `application.stage === to` skip in applyDecisions -> this test failed (6 stage audits, not 2)
  it('their stages move once, even delivered again: Sara to "Round 2 shortlist", Arjun to "Not advanced", Huda held', async () => {
    const event = await recorded();
    const from = await stageOf(sara);
    expect(await deliver(event)).toEqual(['complete']);
    expect([await stageOf(sara), await stageOf(arjun), await stageOf(huda)]).toEqual([
      'round2_shortlist',
      'not_advanced',
      from,
    ]);
    // The same message again (the inbox), and the same event as a new message (each is at its stage already).
    expect(await deliver(event)).toEqual(['complete']);
    expect(await deliver({ ...event, id: crypto.randomUUID() })).toEqual(['complete']);
    const audits = await stageAudits();
    expect(audits).toHaveLength(2);
    for (const a of audits) expect([a.actor_type, a.actor_id, a.note]).toEqual(['user', HASSAN, WHY]);
    expect(audits.map((a) => a.after)).toEqual(
      expect.arrayContaining([
        { stage: 'round2_shortlist', jobId, packId },
        { stage: 'not_advanced', jobId, packId },
      ]),
    );
    // Nothing reaches a candidate: no notification, and no event in any other module's outbox.
    expect(await sideEffects()).toEqual(before);
  });
});

describe('Scenario: Not advanced candidates stay visible', () => {
  it('Arjun stays in the ranking with stage "Not advanced" and can be added to a later pack', async () => {
    const ranking = await as(ZAID, w1, (ctx) => assessment.listRanking(ctx, jobId));
    expect(ranking.status === 'ranked' && ranking.rows.map((r) => r.candidateId)).toContain(arjun);
    expect(await stageOf(arjun)).toBe('not_advanced');
    const later = await as(ZAID, w1, (ctx) =>
      decisions.createPack(ctx, { jobId, name: 'Round 2 reserve', members: [{ candidateId: arjun }] }),
    );
    expect(
      (await as(ZAID, w1, (ctx) => decisions.getPack(ctx, later.packId)))?.members.map((m) => m.candidateId),
    ).toEqual([arjun]);
  });
});

describe('intake.inbox row-level security (ADR-005)', () => {
  // SAFETY: mutation check: CREATE POLICY leak ON intake.inbox USING (true) in migration 0007 -> this test failed (W1's rows read in W2)
  it('with no WHERE clause, W2 and a query with no workspace read none of W1’s handled messages', async () => {
    expect(await withWorkspace(app, w1, async (tx) => (await tx.execute(sql`select 1 from intake.inbox`)).length)).toBe(
      2,
    );
    expect(await withWorkspace(app, w2, async (tx) => (await tx.execute(sql`select 1 from intake.inbox`)).length)).toBe(
      0,
    );
    expect(await app.transaction(async (tx) => (await tx.execute(sql`select 1 from intake.inbox`)).length)).toBe(0);
  });
});
