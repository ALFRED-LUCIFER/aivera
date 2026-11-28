import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { AiUnavailable, createAiClient, fakeProvider, MAP_TO_COMPETENCY_VERSION, modelOf } from '@credalent/ai';
import { createAudit } from '@credalent/audit/composition';
import type { CandidatesContract } from '@credalent/candidates';
import { createCandidates, readPersonAsSystem } from '@credalent/candidates/composition';
import { createDb, withWorkspace, type Db } from '@credalent/db';
import { newEnvelope, type Envelope } from '@credalent/db/outbox';
import { PermanentFailure, type Handler } from '@credalent/db/consumer';
import {
  CLAIM_LIMIT,
  EvidenceMappingRequestedV1,
  EvidenceRecordedV1,
  type EvidenceContract,
} from '@credalent/evidence';
import { createEvidence, createEvidenceMappingHandlers } from '@credalent/evidence/composition';
import { RubricApprovedV1 } from '@credalent/jobs';
import { ForbiddenError, type WorkspaceContext, type WorkspacesContract } from '@credalent/workspaces';
import { createWorkspaces } from '@credalent/workspaces/composition';
import type { MockLanguageModelV4 } from 'ai/test';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// AIV-P1-027 acceptance scenarios: the worker job `evidence.mapping` against real PostgreSQL as aivera_app, with the
// fake model answering what a test sets. The approved rubric and the applications are the jobs and intake modules'
// worker reads, stubbed here (their own tests cover them). Synthetic cast only (docs/00-product/personas.md).

const rolesSql = readFileSync(createRequire(import.meta.url).resolve('@credalent/db/sql/roles.sql'), 'utf8');
const dbCli = join(import.meta.dirname, '..', '..', '..', 'packages', 'db', 'src', 'cli.ts');

const ALEX = '0190d4a2-0000-7000-8000-00000000a1e1';
const LINA = '0190d4a2-0000-7000-8000-0000000011aa';
const NOW = new Date('2026-11-20T09:00:00.000Z');
const JOB = '0190d4a2-0000-7000-8000-000000000b01';
const DESIGN_JOB = '0190d4a2-0000-7000-8000-000000000b02';
const V1 = '0190d4a2-0000-7000-8000-0000000a0001';
const V2 = '0190d4a2-0000-7000-8000-0000000a0002';
const RETRIEVAL = '0190d4a2-0000-7000-8000-0000000c0e01';
const COST = '0190d4a2-0000-7000-8000-0000000c0e02';
const PYTHON = '0190d4a2-0000-7000-8000-0000000c0e03';
const ARABIC = '0190d4a2-0000-7000-8000-0000000c0e04';
const STAFF_BACKEND = '0190d4a2-0000-7000-8000-0000000c0e99';

const competencies = [
  { id: RETRIEVAL, name: 'Retrieval and evaluation', evidenceExpected: 'An eval harness.', weightPercent: 40 },
  { id: COST, name: 'Cost and reliability', evidenceExpected: 'Measured cost cuts.', weightPercent: 25 },
  {
    id: PYTHON,
    name: 'Python service engineering',
    evidenceExpected: 'Python services they maintain.',
    weightPercent: 20,
  },
  { id: ARABIC, name: 'Arabic and bilingual NLP', evidenceExpected: 'Arabic datasets.', weightPercent: 15 },
];

let container: StartedPostgreSqlContainer;
let admin: Db;
let app: Db;
let workspaces: WorkspacesContract;
let candidates: CandidatesContract;
let evidence: EvidenceContract;
let w1: string;
let w2: string;
let sara: string;
let repositorySource: string;

// What the stubbed reads and the fake model answer; each test sets what it needs.
let approved: Record<string, string | null> = {};
let completion = '{}';
let failures: number[] = [];
let budgetSpent = false;
const scheduled: { queue: string; type: string; at: Date }[] = [];
const applications = new Map<string, string[]>();

const urlFor = (role: string) =>
  `postgres://${role}:local_dev_only@${container.getHost()}:${container.getPort()}/${container.getDatabase()}`;
const as = <T>(userId: string, workspaceId: string, fn: (ctx: WorkspaceContext) => Promise<T>) =>
  workspaces.withWorkspace({ userId }, workspaceId, fn);

let handlers: Handler<unknown>[];
const handlerFor = (type: string) => {
  const found = handlers.find((h) => h.event.type === type);
  if (!found) throw new Error(`no handler for ${type}`);
  return found;
};
const mapNow = (workspaceId: string, candidateId: string, jobId: string) => {
  const envelope = newEnvelope(EvidenceMappingRequestedV1, {
    workspaceId,
    payload: { candidateId, jobId },
    occurredAt: NOW,
  });
  return withWorkspace(app, workspaceId, (tx) =>
    handlerFor(EvidenceMappingRequestedV1.type).handle(tx, envelope.payload, envelope),
  );
};
const rows = (workspaceId: string, query: ReturnType<typeof sql>) =>
  withWorkspace(app, workspaceId, async (tx) => [...(await tx.execute<Record<string, unknown>>(query))]);

/** Counts as the workspace sees them under row-level security alone: no workspace filter in the query. */
const raw = (workspaceId: string) =>
  rows(
    workspaceId,
    sql`select (select count(*) from evidence.mapping) as runs, (select count(*) from evidence.evidence_gap) as gaps`,
  );

const cite = (sourceId: string, quote: string) => [{ sourceId, quote }];

beforeAll(async () => {
  container = await new PostgreSqlContainer('pgvector/pgvector:pg17').withDatabase('aivera').start();
  admin = createDb(container.getConnectionUri(), { max: 1 });
  await admin.$client.unsafe(rolesSql);
  execFileSync(process.execPath, [dbCli, 'migrate'], {
    env: { ...process.env, DATABASE_MIGRATOR_URL: urlFor('aivera_migrator') },
  });
  // Two: a mapping that fails for good is recorded on its own connection while the delivery holds one (AIV-P1-165).
  app = createDb(urlFor('aivera_app'), { max: 2 });
  const audit = createAudit(app);
  workspaces = createWorkspaces(app, audit);
  candidates = createCandidates(workspaces, () => NOW);
  evidence = // These suites record evidence without applications, so the job resolver is a fake naming the requested job.
    createEvidence(
      workspaces,
      audit,
      () => NOW,
      async (_ctx, _candidateId, jobId) => ({ jobId }),
    );
  const fake = fakeProvider();
  handlers = createEvidenceMappingHandlers({
    db: app,
    ai: createAiClient({
      // Read per call, so each test's answer and failures apply.
      provider: { ...fake, languageModel: (d) => fakeProvider({ completion, failures }).languageModel(d) },
      budget: {
        spentToday: async () => ({ spent: budgetSpent ? 10_000_000 : 0, limit: 10_000_000 }),
        add: async () => {},
      },
      sleep: async () => {},
    }),
    approvedRubric: async (_tx, _workspaceId, jobId) => {
      const id = approved[jobId];
      return id ? { id, competencies } : null;
    },
    applications: {
      jobsForCandidate: async (_tx, _w, candidateId) => applications.get(candidateId) ?? [],
      candidatesForJob: async (_tx, _w, jobId) =>
        [...applications].filter(([, j]) => j.includes(jobId)).map(([c]) => c),
    },
    readPerson: readPersonAsSystem,
    scheduler: {
      schedule: async (queue, envelope, at) => (scheduled.push({ queue, type: envelope.type, at }), '1'),
      cancel: async () => undefined,
    },
    now: () => NOW,
  });

  const newWorkspace = async (name: string) =>
    (await workspaces.createWorkspace({ name, company: name, hiringFocus: 'AI', synthetic: true, creatorUserId: ALEX }))
      .id;
  w1 = await newWorkspace('Demo hiring team');
  w2 = await newWorkspace('Gulf Talent Partners');
  sara = await as(ALEX, w1, async (ctx) => {
    const created = await candidates.findOrCreatePerson(ctx, {
      displayName: 'Sara Al Qahtani',
      identifiers: [{ type: 'email', value: 'sara.al.qahtani@example.com' }],
      synthetic: true,
    });
    return created.personId;
  });
  await withWorkspace(app, w1, (tx) =>
    tx.execute(
      sql`insert into workspaces.member (workspace_id, user_id, role, status) values (${w1}, ${LINA}, 'interviewer', 'active')`,
    ),
  );

  // Sara's repository, read: 412 of 460 commits (clear authorship), its authorship item, and an older one a re-read
  // replaced. Her CV claim is recorded as a claim.
  repositorySource = await as(ALEX, w1, async (ctx) => {
    const { sourceId } = await evidence.requestRepositoryRead(ctx, {
      candidateId: sara,
      url: 'https://github.com/sara-credalent-example/llm-eval-harness',
      githubLogin: 'sara-credalent-example',
      emails: [],
      synthetic: true,
    });
    await ctx.tx.execute(sql`update evidence.repository_read set status = 'read', total_commits = 460,
      authored_commits = 412, generated_only_commits = 0, generated_checked = 300, commits_truncated = false,
      files_inspected = 40 where source_id = ${sourceId}`);
    for (const [excerpt, at] of [
      ['authored 380 of 430 commits', '2026-10-01T08:00:00Z'],
      ['authored 412 of 460 commits', '2026-11-12T08:00:00Z'],
    ])
      await ctx.tx.execute(sql`insert into evidence.item (id, workspace_id, source_id, candidate_id, excerpt,
        provenance, strength, limit_statement, synthetic, created_at) values (gen_random_uuid(), ${w1}, ${sourceId},
        ${sara}, ${excerpt}, 'submitted', 'medium', 'Measured from the commit history.', true, ${at})`);
    await evidence.recordEvidence(ctx, {
      candidateId: sara,
      source: {
        kind: 'cv',
        label: 'CV',
        url: null,
        blobFileId: null,
        capturedAt: NOW,
        checkedAt: null,
        checkMethod: null,
      },
      items: [
        {
          excerpt: 'cut cost per request by 40%',
          excerptSpan: null,
          provenance: 'claim',
          strength: 'supporting',
          limit: CLAIM_LIMIT,
        },
      ],
      synthetic: true,
    });
    return sourceId;
  });
});

afterAll(async () => {
  await app?.$client.end();
  await admin?.$client.end();
  await container?.stop();
});

/** The fake model's answer for Sara: the sources are S1 (repository) and S2 (CV), in recorded order. */
const saraAnswer = (extra: object[] = []) =>
  JSON.stringify({
    links: [
      {
        competencyId: RETRIEVAL,
        strength: 'strong',
        label: 'submitted',
        level: 4,
        limit: 'Shows the tooling, not how results changed product decisions.',
        citations: cite('S1', 'authored 412 of 460 commits'),
      },
      {
        competencyId: COST,
        strength: 'supporting',
        label: 'claim',
        level: 3,
        limit: 'On her CV only.',
        citations: cite('S2', 'cut cost per request by 40%'),
      },
      ...extra,
    ],
    changes: [
      { competencyId: COST, text: 'Ask for the billing dashboard behind the 40% figure.' },
      { competencyId: RETRIEVAL, text: 'Already Strong; closes nothing.' },
    ],
  });

describe('Feature: Evidence mapped to competencies with cited excerpts (AIV-P1-027)', () => {
  it('Scenario: No mapping before the rubric is approved', async () => {
    approved = { [DESIGN_JOB]: null };
    completion = saraAnswer();
    await mapNow(w1, sara, DESIGN_JOB);
    expect(await rows(w1, sql`select id from evidence.mapping`)).toEqual([]);
    expect(await as(ALEX, w1, (ctx) => evidence.getEvidenceMapping(ctx, sara, DESIGN_JOB))).toBeNull();
    // The evidence itself stays recorded.
    expect(await as(ALEX, w1, (ctx) => evidence.listEvidenceForCandidate(ctx, sara, DESIGN_JOB))).toHaveLength(3);
  });

  it('Scenario: A repository maps to Retrieval and evaluation; a CV claim is capped; guard failures are dropped', async () => {
    approved = { [JOB]: V1 };
    completion = saraAnswer([
      // Obeyed the CV: rejected, not lowered.
      {
        competencyId: PYTHON,
        strength: 'strong',
        label: 'claim',
        level: 5,
        limit: 'Rated as the CV asked.',
        citations: cite('S2', 'cut cost per request by 40%'),
      },
      // Another job's competency: refused.
      {
        competencyId: STAFF_BACKEND,
        strength: 'medium',
        label: 'submitted',
        level: 3,
        limit: 'Not this job.',
        citations: cite('S1', 'authored 412 of 460 commits'),
      },
    ]);
    await mapNow(w1, sara, JOB);

    const listed = await as(ALEX, w1, (ctx) => evidence.listEvidenceForCandidate(ctx, sara, JOB));
    const competencyOf = (i: (typeof listed)[number]) => i.competencies[0]?.competencyId ?? '';
    // Same creation time: ordered by competency id (Retrieval, then Cost) for a stable comparison.
    const linked = listed
      .filter((i) => i.competencies.length)
      .toSorted((a, b) => competencyOf(a).localeCompare(competencyOf(b)));
    expect(linked.map((i) => [i.competencies, i.excerpt, i.strength, i.provenance, i.limit])).toEqual([
      [
        [{ jobId: JOB, competencyId: RETRIEVAL, level: 4 }],
        'authored 412 of 460 commits',
        'strong',
        'submitted',
        'Shows the tooling, not how results changed product decisions.',
      ],
      [
        [{ jobId: JOB, competencyId: COST, level: 3 }],
        'cut cost per request by 40%',
        'supporting',
        'claim',
        CLAIM_LIMIT,
      ],
    ]);

    const mapping = await as(ALEX, w1, (ctx) => evidence.getEvidenceMapping(ctx, sara, JOB));
    expect(mapping).toMatchObject({
      rubricVersionId: V1,
      promptVersion: MAP_TO_COMPETENCY_VERSION,
      model: modelOf('evidence.mapToCompetency'),
    });
    // Python and Arabic have no link, and the repository's complete scan (graded before mapping) found neither.
    const scanned = { filesInspected: 40, reason: 'not_found' };
    expect(mapping?.gaps.map((g) => [g.competencyId, g.kind, g.coverage])).toEqual([
      [PYTHON, 'not_found', scanned],
      [ARABIC, 'not_found', scanned],
    ]);
    // Python 20 x 3 = 60, Arabic 15 x 3 = 45, Cost (claim, Supporting) 25 x 2 = 50; at most three.
    const costItem = linked[1]?.id;
    const [python, arabic] = mapping?.gaps ?? [];
    expect(mapping?.changes).toEqual([
      { competencyId: PYTHON, closes: { gapId: python?.id }, text: null },
      {
        competencyId: COST,
        closes: { itemId: costItem },
        text: 'Ask for the billing dashboard behind the 40% figure.',
      },
      { competencyId: ARABIC, closes: { gapId: arabic?.id }, text: null },
    ]);
    // EvidenceMapped.v1 is in the outbox for the assessment (AIV-P1-031).
    expect(await rows(w1, sql`select payload from evidence.outbox where type = 'EvidenceMapped.v1'`)).toEqual([
      { payload: { candidateId: sara, jobId: JOB, rubricVersionId: V1, mappingId: mapping?.id } },
    ]);
  });

  it('maps only the newest authorship item of a re-read repository', async () => {
    const mapped = await rows(w1, sql`select excerpt from evidence.item where mapping_id is not null`);
    expect(mapped.map((r) => r['excerpt'])).not.toContain('authored 380 of 430 commits');
  });

  it('Scenario: Not found is an evidence gap, never negative evidence', async () => {
    // A complete scan of the repository found no Python: the grade bounds the model's link away entirely.
    completion = saraAnswer([
      {
        competencyId: PYTHON,
        strength: 'claim',
        label: 'submitted',
        level: 1,
        limit: 'No Python.',
        citations: cite('S1', 'authored 412 of 460 commits'),
      },
    ]);
    await mapNow(w1, sara, JOB);
    const mapping = await as(ALEX, w1, (ctx) => evidence.getEvidenceMapping(ctx, sara, JOB));
    expect(mapping?.gaps.find((g) => g.competencyId === PYTHON)).toMatchObject({
      kind: 'not_found',
      coverage: { filesInspected: 40, reason: 'not_found' },
    });
    const listed = await as(ALEX, w1, (ctx) => evidence.listEvidenceForCandidate(ctx, sara, JOB));
    expect(
      listed
        .flatMap((i) => i.competencies)
        .map((c) => c.competencyId)
        .toSorted(),
    ).toEqual([RETRIEVAL, COST].toSorted());
  });

  it('re-mapping on a new rubric version keeps the earlier runs for audit and reads only the newest', async () => {
    approved = { [JOB]: V2 };
    completion = saraAnswer();
    await mapNow(w1, sara, JOB);
    const runs = await rows(w1, sql`select rubric_version_id from evidence.mapping order by created_at, id`);
    expect(runs.map((r) => r['rubric_version_id'])).toEqual([V1, V1, V2]);
    expect(
      Number((await rows(w1, sql`select count(*) as n from evidence.item where mapping_id is not null`))[0]?.['n']),
    ).toBe(6);
    expect((await as(ALEX, w1, (ctx) => evidence.getEvidenceMapping(ctx, sara, JOB)))?.rubricVersionId).toBe(V2);
    // The job's list shows the recorded items and the newest run's two, never an earlier run's.
    const listed = await as(ALEX, w1, (ctx) => evidence.listEvidenceForCandidate(ctx, sara, JOB));
    expect(listed.filter((i) => i.competencies.length)).toHaveLength(2);
    expect(listed).toHaveLength(5);
  });

  it('Scenario: Model unavailable: the job throws so the consumer retries with back-off, and nothing is stored', async () => {
    failures = [503, 503, 503];
    await expect(mapNow(w1, sara, JOB)).rejects.toThrow(AiUnavailable);
    failures = [];
    expect(await rows(w1, sql`select id from evidence.mapping`)).toHaveLength(3);
  });

  it('Scenario: Mapping out of budget reschedules for 00:05 UTC the next day and stores nothing (AIV-P1-089)', async () => {
    const before = await rows(w1, sql`select id from evidence.mapping`);
    budgetSpent = true;
    scheduled.length = 0;
    try {
      await mapNow(w1, sara, JOB);
    } finally {
      budgetSpent = false;
    }
    expect(scheduled).toEqual([
      { queue: 'evidence', type: 'EvidenceMappingRequested.v1', at: new Date('2026-11-21T00:05:00.000Z') },
    ]);
    expect(await rows(w1, sql`select id from evidence.mapping`)).toHaveLength(before.length);
  });

  it.each([
    '{}',
    JSON.stringify({
      links: [{ competencyId: RETRIEVAL, strength: 'strong', label: 'submitted', level: 4, limit: 'x', citations: [] }],
      changes: [],
    }),
  ])('Scenario: A permanent rejection is dead-lettered on the first delivery, not retried (%#)', async (bad) => {
    completion = bad;
    try {
      await expect(mapNow(w1, sara, JOB)).rejects.toBeInstanceOf(PermanentFailure);
    } finally {
      completion = '{}';
    }
  });

  it('evidence and rubric changes fan out to one mapping request per candidate and job', async () => {
    applications.set(sara, [JOB, DESIGN_JOB]);
    const recorded = newEnvelope(EvidenceRecordedV1, {
      workspaceId: w1,
      payload: { candidateId: sara, sourceId: repositorySource, itemIds: [] },
      occurredAt: NOW,
    });
    const rubric = newEnvelope(RubricApprovedV1, {
      workspaceId: w1,
      payload: { jobId: JOB, rubricVersionId: V2, supersededVersionId: V1 },
      occurredAt: NOW,
    });
    await withWorkspace(app, w1, async (tx) => {
      await handlerFor(EvidenceRecordedV1.type).handle(tx, recorded.payload, recorded);
      await handlerFor(RubricApprovedV1.type).handle(tx, rubric.payload, rubric);
    });
    const requested = await rows(
      w1,
      sql`select payload from evidence.outbox where type = 'EvidenceMappingRequested.v1'
        order by payload->>'jobId', id`,
    );
    expect(requested.map((r) => r['payload'])).toEqual([
      { candidateId: sara, jobId: JOB },
      { candidateId: sara, jobId: JOB },
      { candidateId: sara, jobId: DESIGN_JOB },
    ]);
  });

  // SAFETY: mutation check: set the evidence.mapping and evidence_gap tenant policies to USING (true) -> this test failed
  it('row-level security hides mapping runs and gaps from another workspace with no repository filter', async () => {
    expect((await raw(w1))[0]).not.toEqual({ runs: '0', gaps: '0' });
    expect((await raw(w2))[0]).toEqual({ runs: '0', gaps: '0' });
    expect(await as(ALEX, w2, (ctx) => evidence.getEvidenceMapping(ctx, sara, JOB))).toBeNull();
  });

  // SAFETY: mutation check: dropped the job resource from authorize in getEvidenceMapping -> this test failed
  it('an interviewer reads the mapping only for a job they are granted', async () => {
    await expect(as(LINA, w1, (ctx) => evidence.getEvidenceMapping(ctx, sara, JOB))).rejects.toThrow(ForbiddenError);
    await withWorkspace(app, w1, (tx) =>
      tx.execute(sql`insert into workspaces.job_grant (id, workspace_id, user_id, job_id, granted_by)
        values (gen_random_uuid(), ${w1}, ${LINA}, ${JOB}, ${ALEX})`),
    );
    expect((await as(LINA, w1, (ctx) => evidence.getEvidenceMapping(ctx, sara, JOB)))?.rubricVersionId).toBe(V2);
  });
});

// AIV-P2-062: each scenario has its own candidate, so it reads only its own runs. Synthetic cast (personas.md).
const claim = 'built a retrieval eval harness for 3 products';
const answerAt = (level: number) =>
  JSON.stringify({
    links: [
      {
        competencyId: RETRIEVAL,
        strength: 'supporting',
        label: 'claim',
        level,
        limit: 'On the CV only.',
        citations: cite('S1', claim),
      },
    ],
    changes: [],
  });
const recordCv = (candidateId: string, excerpt: string, label = 'CV') =>
  as(ALEX, w1, (ctx) =>
    evidence.recordEvidence(ctx, {
      candidateId,
      source: { kind: 'cv', label, url: null, blobFileId: null, capturedAt: NOW, checkedAt: null, checkMethod: null },
      items: [{ excerpt, excerptSpan: null, provenance: 'claim', strength: 'supporting', limit: CLAIM_LIMIT }],
      synthetic: true,
    }),
  );
const newCandidate = (displayName: string, email: string) =>
  as(ALEX, w1, async (ctx) => {
    const created = await candidates.findOrCreatePerson(ctx, {
      displayName,
      identifiers: [{ type: 'email', value: email }],
      synthetic: true,
    });
    return created.personId;
  });

describe('Feature: Evidence mapping runs in order and stays bounded (AIV-P2-062)', () => {
  // SAFETY: mutation check: removed the advisory lock from mapEvidence -> this test failed
  // SAFETY: mutation check: left the workspace id out of the lock key -> this test failed
  // SAFETY: mutation check: waited on the lock (pg_advisory_xact_lock) instead of rescheduling -> this test failed
  it('Scenario: Concurrent runs keep the newest, and the lock key names the workspace', async () => {
    approved = { [JOB]: V2 };
    const omar = await newCandidate('Omar Al Suwaidi', 'omar.al.suwaidi@example.com');
    await recordCv(omar, claim);

    const { promise: held, resolve: release } = Promise.withResolvers<void>();
    const { promise: started, resolve: firstStarted } = Promise.withResolvers<void>();
    let calls = 0;
    let inFlight = 0;
    let most = 0;
    // The first run's model call waits until released and answers level 2; every later call answers level 3.
    const fake = fakeProvider();
    const gated: typeof fake = {
      ...fake,
      languageModel: (deployment) => {
        const n = calls++;
        // The fake's model is a MockLanguageModelV4 (packages/ai providers.ts).
        const model = fakeProvider({ completion: answerAt(n === 0 ? 2 : 3) }).languageModel(
          deployment,
        ) as MockLanguageModelV4;
        const generate = model.doGenerate.bind(model);
        return Object.assign(model, {
          doGenerate: async (options: Parameters<typeof generate>[0]) => {
            most = Math.max(most, ++inFlight);
            try {
              if (n === 0) {
                firstStarted();
                await held;
              }
              return await generate(options);
            } finally {
              inFlight--;
            }
          },
        });
      },
    };
    let tick = NOW.getTime();
    const rescheduled: Envelope[] = [];
    const delays: number[] = [];
    const ordered = createEvidenceMappingHandlers({
      db: app,
      ai: createAiClient({
        provider: gated,
        budget: { spentToday: async () => ({ spent: 0, limit: 10_000_000 }), add: async () => {} },
        sleep: async () => {},
      }),
      approvedRubric: async (_tx, _workspaceId, jobId) => (approved[jobId] ? { id: V2, competencies } : null),
      applications: { jobsForCandidate: async () => [], candidatesForJob: async () => [] },
      readPerson: readPersonAsSystem,
      scheduler: {
        schedule: async (_queue, envelope, at) => {
          rescheduled.push(envelope);
          delays.push(at.getTime() - new Date(envelope.occurredAt).getTime());
          return '1';
        },
        cancel: async () => undefined,
      },
      // Each call a second later, so the order the runs were claimed in shows in createdAt.
      now: () => new Date((tick += 1000)),
    }).find((h) => h.event.type === EvidenceMappingRequestedV1.type);
    if (!ordered) throw new Error('no mapping handler');
    // Three connections: the two runs and the lock probe.
    const pool = createDb(urlFor('aivera_app'), { max: 3 });
    const run = (
      envelope: Envelope = newEnvelope(EvidenceMappingRequestedV1, {
        workspaceId: w1,
        payload: { candidateId: omar, jobId: JOB },
        occurredAt: NOW,
      }),
    ) => withWorkspace(pool, w1, (tx) => ordered.handle(tx, envelope.payload, envelope));
    const tryLock = (workspaceId: string) =>
      withWorkspace(pool, workspaceId, async (tx) => {
        const key = `evidence.mapping:${workspaceId}:${omar}:${JOB}`;
        const [row] = await tx.execute<{ got: boolean }>(
          sql`select pg_try_advisory_xact_lock(hashtextextended(${key}, 0)) as got`,
        );
        return row?.got;
      });
    try {
      const older = run();
      await started;
      // The newer run does not wait on the lock (it would outlast lock_timeout behind a model call): it is rescheduled.
      await run();
      expect(rescheduled).toHaveLength(1);
      // Not retried at once: it waits out the run in flight.
      expect(delays[0]).toBeGreaterThanOrEqual(60_000);
      expect(await tryLock(w1)).toBe(false);
      expect(await tryLock(w2)).toBe(true);
      release();
      await older;
      const [again] = rescheduled;
      if (!again) throw new Error('not rescheduled');
      await run(again);
    } finally {
      release();
      await pool.$client.end();
    }

    expect(most).toBe(1);
    const listed = await as(ALEX, w1, (ctx) => evidence.listEvidenceForCandidate(ctx, omar, JOB));
    expect(listed.flatMap((i) => i.competencies)).toEqual([{ jobId: JOB, competencyId: RETRIEVAL, level: 3 }]);
  });

  it('Scenario: An oversized source is not truncated silently', async () => {
    approved = { [JOB]: V2 };
    const karim = await newCandidate('Karim Nasser', 'karim.nasser@example.com');
    await recordCv(karim, claim);
    const text = `${claim} `.repeat(11_000);
    expect(text.length).toBeGreaterThan(500_000);
    const { sourceId: long } = await recordCv(karim, text, 'Write-up');
    // Only the CV is sent (as S1); the citation contract rejects any quote of a source that was not.
    completion = answerAt(3);
    await mapNow(w1, karim, JOB);

    const mapping = await as(ALEX, w1, (ctx) => evidence.getEvidenceMapping(ctx, karim, JOB));
    expect(mapping?.tooLongSourceIds).toEqual([long]);
    const cited = (await as(ALEX, w1, (ctx) => evidence.listEvidenceForCandidate(ctx, karim, JOB))).filter(
      (i) => i.competencies.length,
    );
    expect(cited.map((i) => i.sourceId)).not.toContain(long);
    expect(cited).toHaveLength(1);
  });
});

const linkTo = (competencyId: string, quote: string) => ({
  competencyId,
  strength: 'supporting',
  label: 'claim',
  level: 2,
  limit: 'On the CV only.',
  citations: cite('S1', quote),
});
// One CV laid out one short fragment per line, as a PDF extraction gives it.
const recordFragments = (candidateId: string) =>
  as(ALEX, w1, (ctx) =>
    evidence.recordEvidence(ctx, {
      candidateId,
      source: {
        kind: 'cv',
        label: 'CV',
        url: null,
        blobFileId: null,
        capturedAt: NOW,
        checkedAt: null,
        checkMethod: null,
      },
      items: ['QA Automation Engineer', 'Wrote the Playwright suite', 'Ran it in CI'].map((excerpt) => ({
        excerpt,
        excerptSpan: null,
        provenance: 'claim' as const,
        strength: 'supporting' as const,
        limit: CLAIM_LIMIT,
      })),
      synthetic: true,
    }),
  );
describe("Feature: One uncited link no longer wipes out a candidate's mapped evidence (AIV-P1-156)", () => {
  // SAFETY: mutation check: stored uncitedLinkCount 0 in mapEvidence -> this test failed
  it('Scenario: A link whose quote is not in the CV is dropped and the others are kept', async () => {
    approved = { [JOB]: V2 };
    const imran = await newCandidate('Imran Qureshi', 'imran.qureshi@example.com');
    await recordFragments(imran);
    completion = JSON.stringify({
      links: [
        linkTo(RETRIEVAL, 'Wrote the Playwright suite'),
        linkTo(PYTHON, 'Ran it in CI'),
        // Joined from two separate lines: not in the source, so dropped, never re-quoted.
        linkTo(COST, 'Wrote the Playwright suite in CI'),
      ],
      changes: [],
    });
    await mapNow(w1, imran, JOB);

    const mapping = await as(ALEX, w1, (ctx) => evidence.getEvidenceMapping(ctx, imran, JOB));
    expect(mapping?.uncitedLinkCount).toBe(1);
    const linked = (await as(ALEX, w1, (ctx) => evidence.listEvidenceForCandidate(ctx, imran, JOB))).filter(
      (i) => i.competencies.length,
    );
    expect(linked.map((i) => [i.excerpt, i.competencies[0]?.competencyId]).toSorted()).toEqual(
      [
        ['Ran it in CI', PYTHON],
        ['Wrote the Playwright suite', RETRIEVAL],
      ].toSorted(),
    );
    // The run and its event carry no quote: the count is the only trace of the dropped link.
    const [run] = await rows(w1, sql`select * from evidence.mapping where id = ${mapping?.id ?? ''}`);
    const [event] = await rows(
      w1,
      sql`select payload from evidence.outbox where payload->>'mappingId' = ${mapping?.id ?? ''}`,
    );
    expect(JSON.stringify([run, event])).not.toMatch(/Playwright suite in CI|Imran|Qureshi/);
  });

  it('Scenario: Every link dropped still stores the run, with its count and no link', async () => {
    approved = { [JOB]: V2 };
    const noura = await newCandidate('Noura Al Ketbi', 'noura.al.ketbi@example.com');
    await recordFragments(noura);
    completion = JSON.stringify({
      links: [linkTo(RETRIEVAL, 'Wrote the Playwright suite in CI'), linkTo(PYTHON, 'Led a team of 12')],
      changes: [],
    });
    await mapNow(w1, noura, JOB);

    expect((await as(ALEX, w1, (ctx) => evidence.getEvidenceMapping(ctx, noura, JOB)))?.uncitedLinkCount).toBe(2);
    const listed = await as(ALEX, w1, (ctx) => evidence.listEvidenceForCandidate(ctx, noura, JOB));
    expect(listed.filter((i) => i.competencies.length)).toEqual([]);
    // The recorded CV lines stay, unlinked: nothing about her is hidden.
    expect(listed).toHaveLength(3);
  });
});

const failedFor = (workspaceId: string, candidateId: string) =>
  as(ALEX, workspaceId, (ctx) => evidence.listCvStatuses(ctx, JOB, [candidateId]));
const mappingRequests = (candidateId: string) =>
  rows(
    w1,
    sql`select id from evidence.outbox where type = 'EvidenceMappingRequested.v1'
      and payload->>'candidateId' = ${candidateId} and payload->>'jobId' = ${JOB}`,
  );

const failuresCounted = (workspaceId: string) =>
  rows(workspaceId, sql`select count(*)::int as n from evidence.mapping_failure`).then((r) => r[0]?.['n']);

describe('Feature: A mapping that fails permanently shows "could not assess" with retry (AIV-P1-165)', () => {
  // SAFETY: mutation check: removed the own-transaction write of the failure in createEvidenceMappingHandlers -> this
  // test failed (mappingFailed false)
  it('Scenario: the failed state is written outside the rolled-back transaction, so it is never lost', async () => {
    approved = { [JOB]: V2 };
    const hala = await newCandidate('Hala Saleh', 'hala.saleh@example.com');
    await recordFragments(hala);
    completion = '{}';
    try {
      await expect(mapNow(w1, hala, JOB)).rejects.toBeInstanceOf(PermanentFailure);
    } finally {
      completion = '{}';
    }
    // The delivery rolled back: no run. The failure is there all the same.
    expect(await rows(w1, sql`select id from evidence.mapping where candidate_id = ${hala}`)).toEqual([]);
    expect((await failedFor(w1, hala))[0]?.mappingFailed).toBe(true);
  });

  // SAFETY: mutation check: dropped the audit call from retryMapping -> this test failed (no evidence.retried entry)
  // SAFETY: mutation check: made clearFailure always return true -> this test failed (a second retry queued again)
  it('Scenario: "Try again" re-runs the assessment for that candidate and job only, audited; a second retry writes nothing', async () => {
    approved = { [JOB]: V2 };
    const omar = await newCandidate('Omar Al Suwaidi', 'omar.al.suwaidi@example.com');
    await recordFragments(omar);
    completion = '{}';
    await expect(mapNow(w1, omar, JOB)).rejects.toBeInstanceOf(PermanentFailure);
    const before = (await mappingRequests(omar)).length;

    await as(ALEX, w1, (ctx) => evidence.retryMapping(ctx, omar, JOB));
    expect(await mappingRequests(omar)).toHaveLength(before + 1);
    expect((await failedFor(w1, omar))[0]?.mappingFailed).toBe(false);
    const [entry] = await rows(
      w1,
      sql`select actor_id, after from audit.entry where action = 'evidence.retried' and subject_id = ${omar}`,
    );
    expect(entry).toMatchObject({ actor_id: ALEX, after: { status: 'pending', jobId: JOB } });

    await expect(as(ALEX, w1, (ctx) => evidence.retryMapping(ctx, omar, JOB))).rejects.toMatchObject({
      code: 'not_retryable',
    });
    expect(await mappingRequests(omar)).toHaveLength(before + 1);

    // The queued run maps, which ends the failure for good.
    completion = JSON.stringify({ links: [linkTo(RETRIEVAL, 'Wrote the Playwright suite')], changes: [] });
    await mapNow(w1, omar, JOB);
    expect((await failedFor(w1, omar))[0]?.mappingFailed).toBe(false);
  });

  // SAFETY: mutation check: authorized retryMapping with 'candidate.view' -> this test failed (the interviewer retried)
  it('Scenario: an interviewer granted the job cannot retry, and nothing is queued', async () => {
    approved = { [JOB]: V2 };
    const priya = await newCandidate('Priya Nair', 'priya.nair@example.com');
    await recordFragments(priya);
    completion = '{}';
    await expect(mapNow(w1, priya, JOB)).rejects.toBeInstanceOf(PermanentFailure);
    const before = (await mappingRequests(priya)).length;
    // Granted the job, so she may read the candidate: only retrying is refused.
    await withWorkspace(app, w1, (tx) =>
      tx.execute(sql`insert into workspaces.job_grant (id, workspace_id, user_id, job_id, granted_by)
        select gen_random_uuid(), ${w1}, ${LINA}, ${JOB}, ${ALEX}
        where not exists (select 1 from workspaces.job_grant where user_id = ${LINA} and job_id = ${JOB})`),
    );
    expect((await as(LINA, w1, (ctx) => evidence.listCvStatuses(ctx, JOB, [priya])))[0]?.mappingFailed).toBe(true);
    await expect(as(LINA, w1, (ctx) => evidence.retryMapping(ctx, priya, JOB))).rejects.toThrow(ForbiddenError);
    expect(await mappingRequests(priya)).toHaveLength(before);
    expect((await failedFor(w1, priya))[0]?.mappingFailed).toBe(true);
  });

  // SAFETY: mutation check: set the mapping_failure policy to true -> this test failed (w2 counted w1's failures)
  it('another workspace reads none of the failures with no repository filter (row-level security)', async () => {
    expect(await failuresCounted(w1)).toBeGreaterThan(0);
    expect(await failuresCounted(w2)).toBe(0);
  });
});

describe("Feature: A person's linked interview summary is never mapped again (AIV-P1-115)", () => {
  // SAFETY: mutation check: skipped every interview_note item again (the competency-link condition removed) -> this test
  // failed (the unlinked notes were never sent, so nothing linked them to Arabic)
  it('Scenario: An unlinked interview note is mapped like any source, a linked summary is left as the person linked it', async () => {
    approved = { [JOB]: V2 };
    const layla = await newCandidate('Layla Haddad', 'layla.haddad@example.com');
    const notes = 'built the Arabic OCR pipeline and its 300-page test set';
    await as(ALEX, w1, (ctx) =>
      evidence.recordEvidence(ctx, {
        candidateId: layla,
        source: {
          kind: 'interview_note',
          label: 'Round 1 notes',
          url: null,
          blobFileId: null,
          capturedAt: NOW,
          checkedAt: null,
          checkMethod: null,
        },
        items: [{ excerpt: notes, excerptSpan: null, provenance: 'claim', strength: 'supporting', limit: CLAIM_LIMIT }],
        synthetic: true,
      }),
    );
    const summary = 'walked through the retrieval eval set she graded';
    const { itemIds } = await as(ALEX, w1, (ctx) =>
      evidence.recordInterviewSummary(ctx, {
        candidateId: layla,
        jobId: JOB,
        writtenAt: NOW,
        items: [{ competencyId: RETRIEVAL, excerpt: summary, strength: 'medium', level: 3 }],
        synthetic: true,
      }),
    );
    // Only the unlinked notes are sent, as S1.
    completion = JSON.stringify({
      links: [
        {
          competencyId: ARABIC,
          strength: 'supporting',
          label: 'claim',
          level: 2,
          limit: 'In the interview notes only.',
          citations: cite('S1', notes),
        },
      ],
      changes: [],
    });
    await mapNow(w1, layla, JOB);

    const listed = await as(ALEX, w1, (ctx) => evidence.listEvidenceForCandidate(ctx, layla, JOB));
    expect(listed.filter((i) => i.excerpt === notes).flatMap((i) => i.competencies)).toEqual([
      { jobId: JOB, competencyId: ARABIC, level: 2 },
    ]);
    // The summary keeps the one item and link the person confirmed.
    expect(listed.filter((i) => i.excerpt === summary).map((i) => [i.id, i.competencies])).toEqual([
      [itemIds[0], [{ jobId: JOB, competencyId: RETRIEVAL, level: 3 }]],
    ]);
  });
});
