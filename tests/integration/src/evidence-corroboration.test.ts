import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { createAiClient, fakeProvider } from '@credalent/ai';
import type { AssessmentContract } from '@credalent/assessment';
import { createAssessment } from '@credalent/assessment/composition';
import type { AuditContract } from '@credalent/audit';
import { createAudit } from '@credalent/audit/composition';
import type { CandidatesContract } from '@credalent/candidates';
import { createCandidates, readPersonAsSystem } from '@credalent/candidates/composition';
import { createDb, withWorkspace, type Db } from '@credalent/db';
import { newEnvelope } from '@credalent/db/outbox';
import type { Handler } from '@credalent/db/consumer';
import { EvidenceMappingRequestedV1, type EvidenceContract, type SourceKind } from '@credalent/evidence';
import { createEvidence, createEvidenceMappingHandlers } from '@credalent/evidence/composition';
import { createJobs } from '@credalent/jobs/composition';
import { log } from '@credalent/observability';
import { ForbiddenError, type WorkspaceContext, type WorkspacesContract } from '@credalent/workspaces';
import { createWorkspaces } from '@credalent/workspaces/composition';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// AIV-P1-029 and AIV-P1-078 acceptance scenarios against real PostgreSQL as aivera_app: the mapping job (`evidence.mapping`) with the
// fake model linking what each test sets, then the corroboration rules and the numeric pre-check deciding provenance.
// The approved rubric is the jobs module's worker read, stubbed. Synthetic cast only (docs/00-product/personas.md).

const rolesSql = readFileSync(createRequire(import.meta.url).resolve('@credalent/db/sql/roles.sql'), 'utf8');
const dbCli = join(import.meta.dirname, '..', '..', '..', 'packages', 'db', 'src', 'cli.ts');

const ALEX = '0190d4a2-0000-7000-8000-00000000a1e1';
const LINA = '0190d4a2-0000-7000-8000-0000000011aa';
const NOW = new Date('2026-11-20T09:00:00.000Z');
const JOB = '0190d4a2-0000-7000-8000-000000000b01';
const V1 = '0190d4a2-0000-7000-8000-0000000a0001';
const LLM = '0190d4a2-0000-7000-8000-0000000c0e01';
const DISTRIBUTED = '0190d4a2-0000-7000-8000-0000000c0e02';
const ACCURACY = '0190d4a2-0000-7000-8000-0000000c0e03';

const competencies = [
  { id: LLM, name: 'LLM systems in production', evidenceExpected: 'A shipped assistant.', weightPercent: 40 },
  { id: DISTRIBUTED, name: 'Distributed systems', evidenceExpected: 'Queues they built.', weightPercent: 30 },
  { id: ACCURACY, name: 'Answer accuracy', evidenceExpected: 'Measured accuracy gains.', weightPercent: 30 },
];

// Lightly edited copies of one write-up: long enough to fingerprint (AIV-P1-071).
const WRITE_UP =
  'The merchant help assistant answers questions from shop owners about payouts, refunds and disputes. I led the ' +
  'retrieval layer, chose the chunking strategy for the policy documents, built the evaluation set of real merchant ' +
  'questions, and designed the refusal path so the assistant declines to answer when the retrieved policy does not ' +
  'cover the question. ' +
  Array.from(
    { length: 40 },
    (_, i) =>
      `Release ${i + 1} answered ${i * 11 + 40} merchants about refunds, cutting handovers by ${(i % 9) + 2} points.`,
  ).join(' ');
const COPIED = WRITE_UP.replace('Release 3 answered', 'The third release answered').replace(
  'about payouts',
  'about their payouts',
);

let container: StartedPostgreSqlContainer;
let admin: Db;
let app: Db;
let workspaces: WorkspacesContract;
let candidates: CandidatesContract;
let evidence: EvidenceContract;
let audit: AuditContract;
let assessment: AssessmentContract;
let handlers: Handler<unknown>[];
let w1: string;
let w2: string;
let completion = '{}';
/** The fake model's answer to the AI comparison (AIV-P1-078); it flags nothing unless a test sets it. */
let comparison = '{"contradictions":[]}';
/** Every model the fake provider handed out, so a test can read the requests it was sent (AIV-P1-080). */
const models: { doGenerateCalls: { prompt: unknown }[] }[] = [];
const requests = () => models.flatMap((m) => m.doGenerateCalls.map((call) => JSON.stringify(call.prompt)));

const urlFor = (role: string) =>
  `postgres://${role}:local_dev_only@${container.getHost()}:${container.getPort()}/${container.getDatabase()}`;
const as = <T>(userId: string, workspaceId: string, fn: (ctx: WorkspaceContext) => Promise<T>) =>
  workspaces.withWorkspace({ userId }, workspaceId, fn);
const rows = (workspaceId: string, query: ReturnType<typeof sql>) =>
  withWorkspace(app, workspaceId, async (tx) => [...(await tx.execute<Record<string, unknown>>(query))]);

/** Comparisons as the workspace sees them under row-level security alone: no workspace filter in the query. */
const count = (workspaceId: string) => rows(workspaceId, sql`select count(*)::int as n from evidence.comparison`);

const mapNow = (candidateId: string) => {
  const handler = handlers.find((h) => h.event.type === EvidenceMappingRequestedV1.type);
  if (!handler) throw new Error('no mapping handler');
  const envelope = newEnvelope(EvidenceMappingRequestedV1, {
    workspaceId: w1,
    payload: { candidateId, jobId: JOB },
    occurredAt: NOW,
  });
  return withWorkspace(app, w1, (tx) => handler.handle(tx, envelope.payload, envelope));
};

/** The fake model links each `[sourceIndex, quote]` (S1, S2, … in recorded order) to the competency. */
const answer = (competencyId: string, quotes: [number, string, number?][]) =>
  JSON.stringify({
    links: quotes.map(([source, quote, level = 3]) => ({
      competencyId,
      strength: 'medium',
      label: 'submitted',
      level,
      limit: 'Shows the work described, not its scale.',
      citations: [{ sourceId: `S${source}`, quote }],
    })),
    changes: [],
  });

const person = (displayName: string, email: string) =>
  as(ALEX, w1, async (ctx) => {
    const created = await candidates.findOrCreatePerson(ctx, {
      displayName,
      identifiers: [{ type: 'email', value: email }],
      synthetic: true,
    });
    return created.personId;
  });

const record = (candidateId: string, kind: SourceKind, label: string, excerpt: string, text?: string) =>
  as(ALEX, w1, (ctx) =>
    evidence.recordEvidence(ctx, {
      candidateId,
      source: { kind, label, url: null, blobFileId: null, capturedAt: NOW, checkedAt: null, checkMethod: null },
      items: [{ excerpt, excerptSpan: null, provenance: 'submitted', strength: 'medium', limit: 'Their own account.' }],
      synthetic: true,
      ...(text === undefined ? {} : { text }),
    }),
  );

const reference = (candidateId: string, notes: string) =>
  as(ALEX, w1, (ctx) =>
    evidence.recordReferenceCall(ctx, {
      candidateId,
      calledOn: '2026-11-11',
      calledRole: 'manager',
      notes,
      synthetic: true,
    }),
  );

/** The newest run's items for the job linked to `competencyId`, as [source id, provenance]. */
const linked = async (candidateId: string, competencyId: string) =>
  (await as(ALEX, w1, (ctx) => evidence.listEvidenceForCandidate(ctx, candidateId, JOB)))
    .filter((i) => i.competencies.some((c) => c.competencyId === competencyId))
    .map((i) => ({ id: i.id, sourceId: i.sourceId, provenance: i.provenance, limit: i.limit }));

/** The fake AI comparison's answer flagging S1 against S2 with these quotes (AIV-P1-078). */
const flag = (s1: string, s2: string) =>
  JSON.stringify({
    contradictions: [
      {
        citations: [
          { sourceId: 'S1', quote: s1 },
          { sourceId: 'S2', quote: s2 },
        ],
      },
    ],
  });

/** The assessment on one competency alone (LLM unless named). */
const assessed = (candidateId: string, competencyId = LLM) =>
  as(ALEX, w1, async (ctx) =>
    assessment.assessCandidate(ctx, {
      candidateId,
      jobId: JOB,
      rubric: {
        versionId: V1,
        competencies: [{ id: competencyId, weightPercent: 100, levelNeeded: 3, type: 'mandatory' }],
      },
      evidence: await evidence.listEvidenceForCandidate(ctx, candidateId, JOB),
    }),
  );
const backed = async (candidateId: string) => (await assessed(candidateId)).backedScore;

/** The fake model rates every cited quote Strong at level 5 (expert) on one competency (LLM unless named). */
const expert = (quotes: [number, string][], competencyId = LLM) =>
  answer(
    competencyId,
    quotes.map(([source, quote]): [number, string, number] => [source, quote, 5]),
  ).replaceAll('"medium"', '"strong"');

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
  candidates = createCandidates(workspaces, () => NOW);
  evidence = createEvidence(workspaces, audit, () => NOW);
  assessment = createAssessment(
    workspaces,
    audit,
    createJobs(workspaces, audit, () => NOW),
    () => NOW,
  );
  const fake = fakeProvider();
  handlers = createEvidenceMappingHandlers({
    ai: createAiClient({
      provider: {
        ...fake,
        languageModel: (d) => {
          const model = fakeProvider({
            completion,
            fixtures: [{ when: 'Pairs to compare', completion: comparison }],
          }).languageModel(d);
          models.push(model as unknown as { doGenerateCalls: { prompt: unknown }[] });
          return model;
        },
      },
      budget: { spentToday: async () => ({ spent: 0, limit: 10_000_000 }), add: async () => {} },
      sleep: async () => {},
    }),
    approvedRubric: async (_tx, _workspaceId, jobId) => (jobId === JOB ? { id: V1, competencies } : null),
    applications: { jobsForCandidate: async () => [JOB], candidatesForJob: async () => [] },
    readPerson: readPersonAsSystem,
    now: () => NOW,
  });
  const newWorkspace = async (name: string) =>
    (await workspaces.createWorkspace({ name, company: name, hiringFocus: 'AI', synthetic: true, creatorUserId: ALEX }))
      .id;
  w1 = await newWorkspace('Demo hiring team');
  w2 = await newWorkspace('Gulf Talent Partners');
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

describe('Feature: Corroboration and contradictions (AIV-P1-029)', () => {
  // SAFETY: mutation check: removed the authorize call from recordReferenceCall -> this test failed
  it('Scenario: Only recruiters can record reference calls', async () => {
    const sara = await person('Sara Al Qahtani', 'sara.al.qahtani@example.com');
    await expect(reference(sara, 'She led retrieval.').then(() => 'stored')).resolves.toBe('stored');
    const before = await rows(w1, sql`select count(*)::int as n from evidence.source where kind = 'reference_call'`);
    await expect(
      as(LINA, w1, (ctx) =>
        evidence.recordReferenceCall(ctx, {
          candidateId: sara,
          calledOn: '2026-11-11',
          calledRole: 'peer',
          notes: 'Confirmed the retrieval work.',
          synthetic: true,
        }),
      ),
    ).rejects.toThrow(ForbiddenError);
    expect(await rows(w1, sql`select count(*)::int as n from evidence.source where kind = 'reference_call'`)).toEqual(
      before,
    );
  });

  it('refuses a call date that is not a real day or is in the future, storing nothing', async () => {
    const sara = await person('Sara Al Qahtani', 'sara.dates@example.com');
    for (const calledOn of ['2026-02-31', '2026-11-21', '11 Nov'])
      await expect(
        as(ALEX, w1, (ctx) =>
          evidence.recordReferenceCall(ctx, {
            candidateId: sara,
            calledOn,
            calledRole: 'peer',
            notes: 'n',
            synthetic: true,
          }),
        ),
      ).rejects.toThrow('Give the date of the call');
    expect(await rows(w1, sql`select id from evidence.source where candidate_id = ${sara}`)).toEqual([]);
  });

  it('Scenario: A reference call corroborates a shipped product, citing both sources', async () => {
    const sara = await person('Sara Al Qahtani', 'sara.corroborated@example.com');
    const writeUp = await record(sara, 'shipped_product', 'Merchant help assistant', WRITE_UP, WRITE_UP);
    const call = await reference(sara, 'Her manager confirmed she led retrieval and the refusal path.');
    const [source] = await rows(w1, sql`select label, check_method from evidence.source where id = ${call.sourceId}`);
    expect(source).toEqual({ label: 'Reference call, 11 Nov', check_method: 'Reference call (manager)' });

    completion = answer(LLM, [
      [1, 'designed the refusal path'],
      [2, 'led retrieval and the refusal path'],
    ]);
    await mapNow(sara);
    const items = await linked(sara, LLM);
    expect(items.map((i) => [i.sourceId, i.provenance])).toEqual(
      expect.arrayContaining([
        [writeUp.sourceId, 'corroborated'],
        [call.sourceId, 'corroborated'],
      ]),
    );
    expect(items).toHaveLength(2);
  });

  it('Scenario: Two candidate-authored sources do not corroborate each other', async () => {
    const priya = await person('Priya Nair', 'priya.nair@example.com');
    await record(priya, 'document', 'Write-up', 'Built the merchant assistant retrieval layer.');
    await record(priya, 'portal_submission', 'Blog post', 'I built the retrieval layer of a merchant assistant.');
    completion = answer(LLM, [
      [1, 'Built the merchant assistant retrieval layer.'],
      [2, 'I built the retrieval layer of a merchant assistant.'],
    ]);
    await mapNow(priya);
    expect((await linked(priya, LLM)).map((i) => i.provenance)).toEqual(['claim', 'claim']);
  });

  it('Scenario: Near-duplicate sources count as one origin, even as a reference call', async () => {
    const omar = await person('Omar Al Suwaidi', 'omar.al.suwaidi@example.com');
    await record(omar, 'document', 'Merchant assistant write-up', WRITE_UP, WRITE_UP);
    // The same text, lightly edited, under another kind and title.
    await record(omar, 'portal_submission', 'Portal answer', COPIED, COPIED);
    const groups = await as(ALEX, w1, (ctx) => evidence.listOriginGroups(ctx, omar));
    expect(groups).toHaveLength(1);
    completion = answer(LLM, [
      [1, 'designed the refusal path'],
      [2, 'designed the refusal path'],
    ]);
    await mapNow(omar);
    expect((await linked(omar, LLM)).map((i) => i.provenance)).toEqual(['claim', 'claim']);

    // Reference notes copied from the write-up are the same origin too, so they confirm nothing.
    await reference(omar, COPIED);
    completion = answer(LLM, [
      [1, 'designed the refusal path'],
      [3, 'designed the refusal path'],
    ]);
    await mapNow(omar);
    expect((await linked(omar, LLM)).map((i) => i.provenance).toSorted()).toEqual(['claim', 'submitted']);
  });

  it('Scenario Outline: a merged pull request corroborates only when someone else merged it into a repository the candidate does not own', async () => {
    const arjun = await person('Arjun Menon', 'arjun.menon@example.com');
    const writeUp = await record(arjun, 'document', 'Queue library write-up', 'Rewrote the queue library retry path.');
    // AIV-P1-026's records: his supplied login on a read, and an upstream pull request merged by maintainer-b.
    const pullSource = await as(ALEX, w1, async (ctx) => {
      await evidence.requestRepositoryRead(ctx, {
        candidateId: arjun,
        url: 'https://github.com/arjun-menon-example/notes',
        githubLogin: 'arjun-menon-example',
        emails: [],
        synthetic: true,
      });
      const [row] = await ctx.tx.execute<{ source: string; item: string }>(sql`with s as (
          insert into evidence.source (id, workspace_id, candidate_id, kind, label, url, captured_at, checked_at,
            check_method, synthetic, created_at)
          values (gen_random_uuid(), ${w1}, ${arjun}, 'repository', 'queue', 'https://github.com/queue-org/queue',
            ${NOW.toISOString()}, ${NOW.toISOString()}, 'Merged pull request', true, ${NOW.toISOString()}) returning id),
        i as (insert into evidence.item (id, workspace_id, source_id, candidate_id, excerpt, excerpt_span, provenance,
            strength, limit_statement, synthetic, created_at)
          select gen_random_uuid(), ${w1}, s.id, ${arjun}, 'Pull request #12 to queue-org/queue, merged by maintainer-b',
            'queue-org/queue#12', 'submitted', 'supporting', 'Shows that a pull request was merged.', true,
            ${new Date(NOW.getTime() + 60_000).toISOString()} from s returning id, source_id)
        select source_id as source, id as item from i`);
      if (!row) throw new Error('no pull request source');
      await ctx.tx.execute(sql`insert into evidence.merged_pull_request (workspace_id, item_id, candidate_id,
          repository, number, merged_at, merged_by, self_merged)
        values (${w1}, ${row.item}, ${arjun}, 'queue-org/queue', 12, ${NOW.toISOString()}, 'maintainer-b', false)`);
      return row.source;
    });
    completion = answer(DISTRIBUTED, [
      [1, 'Rewrote the queue library retry path.'],
      [2, 'Pull request #12 to queue-org/queue'],
    ]);
    await mapNow(arjun);
    const items = await linked(arjun, DISTRIBUTED);
    expect(items.map((i) => [i.sourceId, i.provenance])).toEqual(
      expect.arrayContaining([
        [writeUp.sourceId, 'corroborated'],
        [pullSource, 'corroborated'],
      ]),
    );
    expect(items).toHaveLength(2);

    // Self-merged: candidate-controlled evidence; the write-up alone is a claim (AIV-P1-087).
    await withWorkspace(app, w1, (tx) =>
      tx.execute(sql`update evidence.merged_pull_request set merged_by = 'arjun-menon-example', self_merged = true
        where candidate_id = ${arjun}`),
    );
    await mapNow(arjun);
    expect((await linked(arjun, DISTRIBUTED)).map((i) => i.provenance).toSorted()).toEqual(['claim', 'submitted']);
  });

  describe('a pre-check contradiction', () => {
    let daniel: string;
    let contradictionId: string;

    // SAFETY: mutation check: stored a withheld link as its withholding settled it, not as it settles once resolved -> this test failed
    it('Scenario: Conflicting numbers are flagged with both excerpts cited, and the backed score leaves them out', async () => {
      daniel = await person('Daniel Novak', 'daniel.novak@example.com');
      await record(daniel, 'document', 'Support assistant write-up', 'Raised 71% → 88% answer accuracy.');
      // A reference call: a write-up beside an interview note alone would back nothing either way (AIV-P1-087).
      await record(daniel, 'reference_call', 'Reference call', 'Her manager said answer accuracy was 80%.');
      completion = answer(ACCURACY, [
        [1, 'Raised 71% → 88% answer accuracy.', 4],
        [2, 'answer accuracy was 80%', 4],
      ]);
      // Events by type: rows share one occurred_at, so their order is not meaningful.
      const outbox = async () =>
        Object.fromEntries(
          (await rows(w1, sql`select type, count(*)::int as n from evidence.outbox group by type`)).map((r) => [
            r['type'],
            r['n'],
          ]),
        );
      const before = await outbox();
      await mapNow(daniel);
      // Nothing moves a stage, rejects or contacts: the run's only event is EvidenceMapped.v1 for the assessment.
      const mapped = { ...before, 'EvidenceMapped.v1': (before['EvidenceMapped.v1'] ?? 0) + 1 };
      expect(await outbox()).toEqual(mapped);

      const items = await linked(daniel, ACCURACY);
      expect(items.map((i) => i.provenance)).toEqual(['contradictory', 'contradictory']);
      const comparisons = await as(ALEX, w1, (ctx) => evidence.listComparisons(ctx, daniel, JOB));
      expect(comparisons).toMatchObject([{ competencyId: ACCURACY, outcome: 'contradiction', resolvedAt: null }]);
      const [contradiction] = comparisons;
      // Both excerpts are cited, by item id.
      expect([contradiction?.itemId, contradiction?.otherItemId].toSorted()).toEqual(items.map((i) => i.id).toSorted());
      contradictionId = contradiction?.id ?? '';

      const score = async () =>
        (
          await as(ALEX, w1, async (ctx) =>
            assessment.assessCandidate(ctx, {
              candidateId: daniel,
              jobId: JOB,
              rubric: {
                versionId: V1,
                competencies: [{ id: ACCURACY, weightPercent: 100, levelNeeded: 3, type: 'mandatory' }],
              },
              evidence: await evidence.listEvidenceForCandidate(ctx, daniel, JOB),
            }),
          )
        ).backedScore;
      expect(await score()).toBe(0);

      await expect(
        as(LINA, w1, (ctx) => evidence.resolveContradiction(ctx, contradictionId, { note: 'x', limit: 'y' })),
      ).rejects.toThrow(ForbiddenError);

      await as(ALEX, w1, (ctx) =>
        evidence.resolveContradiction(ctx, contradictionId, {
          note: 'Reference confirmed scale only roughly',
          limit: 'The user count comes from her own write-up; the reference confirmed the scale only roughly.',
        }),
      );
      expect(await score()).toBeGreaterThan(0);
      // The resolution writes one event, for the assessment, and nothing that moves a stage (AIV-P1-098).
      expect(await outbox()).toEqual({ ...mapped, 'ContradictionResolved.v1': 1 });
      const [event] = await rows(w1, sql`select payload from evidence.outbox where type = 'ContradictionResolved.v1'`);
      expect(event?.['payload']).toEqual({
        candidateId: daniel,
        jobId: JOB,
        rubricVersionId: V1,
        comparisonId: contradictionId,
      });
    });

    it('Scenario: Resolving a contradiction is logged with my name, the time and the note, and the limit reads it', async () => {
      expect(await audit.listFor(w1, { type: 'comparison', id: contradictionId })).toMatchObject([
        {
          action: 'evidence.contradiction_resolved',
          actor: { type: 'user', id: ALEX },
          occurredAt: expect.any(Date),
          note: 'Reference confirmed scale only roughly',
        },
      ]);
      const items = await linked(daniel, ACCURACY);
      expect(items.map((i) => [i.provenance, i.limit])).toEqual([
        ['corroborated', 'The user count comes from her own write-up; the reference confirmed the scale only roughly.'],
        ['corroborated', 'The user count comes from her own write-up; the reference confirmed the scale only roughly.'],
      ]);
    });

    it('a re-map keeps the resolution while the same two excerpts contradict', async () => {
      await mapNow(daniel);
      const comparisons = await as(ALEX, w1, (ctx) => evidence.listComparisons(ctx, daniel, JOB));
      expect(comparisons).toHaveLength(1);
      expect(comparisons[0]?.id).not.toBe(contradictionId);
      expect(comparisons[0]).toMatchObject({
        resolvedBy: ALEX,
        resolutionNote: 'Reference confirmed scale only roughly',
      });
      expect((await linked(daniel, ACCURACY)).map((i) => i.provenance)).toEqual(['corroborated', 'corroborated']);
    });

    it('refuses an empty note and an unknown id', async () => {
      await expect(
        as(ALEX, w1, (ctx) => evidence.resolveContradiction(ctx, contradictionId, { note: ' ', limit: 'y' })),
      ).rejects.toThrow('Write a note');
      await expect(
        as(ALEX, w1, (ctx) =>
          evidence.resolveContradiction(ctx, '0190d4a2-0000-7000-8000-00000000dead', { note: 'n', limit: 'l' }),
        ),
      ).rejects.toThrow('No such contradiction');
    });

    // SAFETY: mutation check: set the evidence.comparison tenant policy to USING (true) -> this test failed
    it('row-level security hides comparisons from another workspace with no repository filter', async () => {
      expect((await count(w1))[0]?.['n']).toBeGreaterThan(0);
      expect(await count(w2)).toEqual([{ n: 0 }]);
      await expect(
        as(ALEX, w2, (ctx) => evidence.resolveContradiction(ctx, contradictionId, { note: 'n', limit: 'l' })),
      ).rejects.toThrow('No such contradiction');
    });

    // SAFETY: mutation check: dropped the job resource from authorize in listComparisons -> this test failed
    it('an interviewer lists comparisons only for a job they are granted', async () => {
      await expect(as(LINA, w1, (ctx) => evidence.listComparisons(ctx, daniel, JOB))).rejects.toThrow(ForbiddenError);
      await withWorkspace(app, w1, (tx) =>
        tx.execute(sql`insert into workspaces.job_grant (id, workspace_id, user_id, job_id, granted_by)
          values (gen_random_uuid(), ${w1}, ${LINA}, ${JOB}, ${ALEX})`),
      );
      expect(await as(LINA, w1, (ctx) => evidence.listComparisons(ctx, daniel, JOB))).toHaveLength(1);
    });
  });

  describe('an AI contradiction (AIV-P1-078)', () => {
    let sara: string;
    let contradictionId: string;

    it('Scenario: Worded numbers are judged by the model: "Contradictory", both excerpts cited, out of the backed score', async () => {
      sara = await person('Sara Al Qahtani', 'sara.worded@example.com');
      await record(
        sara,
        'document',
        'Merchant assistant write-up',
        'About 9,000 merchants use the assistant every week.',
      );
      await reference(sara, 'A few hundred merchants used it while I managed her.');
      completion = answer(LLM, [
        [1, 'About 9,000 merchants use the assistant', 4],
        [2, 'A few hundred merchants used it', 4],
      ]);
      comparison = flag('About 9,000 merchants', 'A few hundred merchants');
      const events = async () => (await rows(w1, sql`select count(*)::int as n from evidence.outbox`))[0]?.['n'];
      const before = await events();
      await mapNow(sara);
      // Only EvidenceMapped.v1: nothing moves a stage, rejects or contacts anyone.
      expect(await events()).toBe(Number(before) + 1);

      const items = await linked(sara, LLM);
      expect(items.map((i) => i.provenance)).toEqual(['contradictory', 'contradictory']);
      const comparisons = await as(ALEX, w1, (ctx) => evidence.listComparisons(ctx, sara, JOB));
      expect(comparisons).toMatchObject([
        { competencyId: LLM, outcome: 'contradiction', method: 'ai', resolvedAt: null },
      ]);
      const [contradiction] = comparisons;
      expect([contradiction?.itemId, contradiction?.otherItemId].toSorted()).toEqual(items.map((i) => i.id).toSorted());
      contradictionId = contradiction?.id ?? '';
      expect(await backed(sara)).toBe(0);
    });

    it('stays open on a re-map whose answer leaves it out: only a person ends it', async () => {
      comparison = '{"contradictions":[]}';
      await mapNow(sara);
      expect(await as(ALEX, w1, (ctx) => evidence.listComparisons(ctx, sara, JOB))).toMatchObject([
        { outcome: 'contradiction', method: 'ai', resolvedAt: null },
      ]);
      expect((await linked(sara, LLM)).map((i) => i.provenance)).toEqual(['contradictory', 'contradictory']);
      contradictionId = (await as(ALEX, w1, (ctx) => evidence.listComparisons(ctx, sara, JOB)))[0]?.id ?? '';
    });

    it('Scenario: An AI contradiction is resolved like any other', async () => {
      const events = async () => (await rows(w1, sql`select count(*)::int as n from evidence.outbox`))[0]?.['n'];
      const before = await events();
      await as(ALEX, w1, (ctx) =>
        evidence.resolveContradiction(ctx, contradictionId, {
          note: 'Reference confirmed scale only roughly',
          limit: 'The merchant count is her own; the reference confirmed the scale only roughly.',
        }),
      );
      expect(await audit.listFor(w1, { type: 'comparison', id: contradictionId })).toMatchObject([
        {
          action: 'evidence.contradiction_resolved',
          actor: { type: 'user', id: ALEX },
          occurredAt: expect.any(Date),
          note: 'Reference confirmed scale only roughly',
        },
      ]);
      expect(await events()).toBe(Number(before) + 1);
      expect(await backed(sara)).toBeGreaterThan(0);
    });

    // SAFETY: mutation check: compareExcerpts (composition) flagged every pair of a rejected answer -> this test failed
    it('Scenario: An answer citing an excerpt that does not exist is rejected and no contradiction is stored', async () => {
      const yousef = await person('Youssef Aziz', 'youssef.aziz@example.com');
      await record(
        yousef,
        'document',
        'Merchant assistant write-up',
        'About 9,000 merchants use the assistant every week.',
      );
      await reference(yousef, 'A few hundred merchants used it while I managed him.');
      completion = answer(LLM, [
        [1, 'About 9,000 merchants use the assistant'],
        [2, 'A few hundred merchants used it'],
      ]);
      comparison = flag('About 9,000 merchants', 'A few hundred merchants').replace('"S2"', '"S3"');
      await mapNow(yousef);
      expect(await as(ALEX, w1, (ctx) => evidence.listComparisons(ctx, yousef, JOB))).toEqual([]);
      expect((await linked(yousef, LLM)).map((i) => i.provenance)).not.toContain('contradictory');
      comparison = '{"contradictions":[]}';
    });
  });
});

describe("Feature: Candidate-written sources cannot be proven on the model's word (AIV-P1-087)", () => {
  const COVER = 'I am an expert in production LLM systems and shipped a merchant assistant.';

  it('Scenario: A candidate-written source alone is a claim: a cover letter scores zero backed', async () => {
    const maria = await person('Maria Santos', 'maria.cover@example.com');
    await record(maria, 'document', 'Cover letter', COVER);
    completion = expert([[1, 'I am an expert in production LLM systems']]);
    await mapNow(maria);
    const items = await as(ALEX, w1, (ctx) => evidence.listEvidenceForCandidate(ctx, maria, JOB));
    const cited = items.filter((i) => i.competencies.some((c) => c.competencyId === LLM));
    expect(cited.map((i) => [i.provenance, i.strength, i.limit, i.competencies[0]?.level])).toEqual([
      [
        'claim',
        'supporting',
        "The candidate's own account: a claim until a second, independent source supports it.",
        4,
      ],
    ]);
    const result = await assessed(maria);
    // Zero backed; the claim widens only "up to M if claims hold" (level 4 of 5 at 100% weight).
    expect([result.backedScore, result.upperBound]).toEqual([0, 80]);
  });

  it('Scenario: A second independent source can still raise strength: a document and a repository, citing both', async () => {
    const priya = await person('Priya Nair', 'priya.second@example.com');
    const letter = await record(priya, 'document', 'Cover letter', COVER);
    // Her repository, read with her login: 90 of 100 commits are hers, a commit history nobody else wrote.
    await as(ALEX, w1, async (ctx) => {
      const { sourceId } = await evidence.requestRepositoryRead(ctx, {
        candidateId: priya,
        url: 'https://github.com/priya-credalent-example/merchant-assistant',
        githubLogin: 'priya-credalent-example',
        emails: [],
        synthetic: true,
      });
      await ctx.tx.execute(sql`update evidence.repository_read set status = 'read', total_commits = 100,
        authored_commits = 90, generated_only_commits = 0, generated_checked = 90, commits_truncated = false,
        files_inspected = 40 where source_id = ${sourceId}`);
      await ctx.tx.execute(sql`insert into evidence.item (id, workspace_id, source_id, candidate_id, excerpt,
        provenance, strength, limit_statement, synthetic, created_at) values (gen_random_uuid(), ${w1}, ${sourceId},
        ${priya}, 'authored 90 of 100 commits', 'submitted', 'medium', 'Measured from the commit history.', true,
        ${new Date(NOW.getTime() + 60_000).toISOString()})`);
    });
    // Distributed systems: no skill signal to grade, so the repository link is not held to a grade (AIV-P1-072).
    completion = expert(
      [
        [1, 'shipped a merchant assistant'],
        [2, 'authored 90 of 100 commits'],
      ],
      DISTRIBUTED,
    );
    await mapNow(priya);
    const items = await linked(priya, DISTRIBUTED);
    expect(items.map((i) => i.provenance)).toEqual(['corroborated', 'corroborated']);
    expect(items.map((i) => i.sourceId)).toContain(letter.sourceId);
    const [shown] = (await assessed(priya, DISTRIBUTED)).competencies;
    expect(shown?.proven.itemIds.toSorted()).toEqual(items.map((i) => i.id).toSorted());
  });

  // SAFETY: mutation check: settled a withheld link with nothing withheld (every open contradiction treated as resolved) -> this test failed
  it('resolving one contradiction never lets a source still in another open contradiction vouch', async () => {
    const hessa = await person('Hessa Al Mazrouei', 'hessa.two.contradictions@example.com');
    const write = await record(hessa, 'document', 'Team write-up', 'Led 12 engineers on the retrieval team.');
    await record(hessa, 'portal_submission', 'Portal answer', 'Led 5 engineers on the retrieval team.');
    await record(hessa, 'reference_call', 'Reference call', 'Her manager said answer accuracy was 80%.');
    await record(hessa, 'document', 'Accuracy write-up', 'Raised answer accuracy to 88%.');
    completion = answer(LLM, [
      [1, 'Led 12 engineers on the retrieval team.'],
      [2, 'Led 5 engineers on the retrieval team.'],
      [3, 'answer accuracy was 80%'],
      [4, 'Raised answer accuracy to 88%.'],
    ]);
    comparison = '{"contradictions":[]}';
    await mapNow(hessa);
    const comparisons = await as(ALEX, w1, (ctx) => evidence.listComparisons(ctx, hessa, JOB));
    expect(comparisons.filter((c) => c.outcome === 'contradiction')).toHaveLength(2);
    const items = await linked(hessa, LLM);
    const writeItem = items.find((i) => i.sourceId === write.sourceId)?.id;
    const teamPair = comparisons.find((c) => c.itemId === writeItem || c.otherItemId === writeItem);
    // Only the head-count contradiction is resolved; the reference call still contradicts the accuracy write-up.
    await as(ALEX, w1, (ctx) =>
      evidence.resolveContradiction(ctx, teamPair?.id ?? '', {
        note: 'The team grew from 5 to 12',
        limit: 'Head count from her own accounts only.',
      }),
    );
    expect((await linked(hessa, LLM)).find((i) => i.sourceId === write.sourceId)?.provenance).toBe('claim');
    expect(await backed(hessa)).toBe(0);
  });
});

describe('Feature: Candidate names and contact details never reach the model (AIV-P1-080)', () => {
  it('Scenario: mapping and comparison send placeholders; stored excerpts keep the text, logs hold neither', async () => {
    const sara = await person('Sara Al Qahtani', 'sara.identifiers@example.com');
    const writeUp =
      "Sara's merchant assistant serves about 9,000 merchants; Al Qahtani wrote the scorer. Call +44 7700 900123.";
    await record(sara, 'document', 'Merchant assistant write-up', writeUp);
    await reference(sara, 'A few hundred merchants used it while I managed Sara (referee: omar@example.com).');
    // The model quotes and writes what it saw; the limit it writes carries the placeholder.
    completion = answer(LLM, [
      [1, '[CANDIDATE] merchant assistant serves about 9,000 merchants', 4],
      [2, 'A few hundred merchants used it', 4],
    ]).replaceAll('Shows the work described', '[CANDIDATE] shows the work described');
    comparison = '{"contradictions":[]}';
    models.length = 0;
    const logs = [vi.spyOn(log, 'info'), vi.spyOn(log, 'warn'), vi.spyOn(log, 'error')];
    await mapNow(sara);
    const logged = JSON.stringify(logs.flatMap((spy) => spy.mock.calls));
    for (const spy of logs) spy.mockRestore();

    const [mapping, compare] = requests();
    expect(mapping).toContain(
      '[CANDIDATE] merchant assistant serves about 9,000 merchants; [CANDIDATE] wrote the scorer. Call [PHONE_1].',
    );
    expect(mapping).toContain('A few hundred merchants used it while I managed [CANDIDATE] (referee: [EMAIL_1]).');
    expect(compare).toContain('[CANDIDATE] merchant assistant serves about 9,000 merchants');
    expect(requests().join(' ')).not.toMatch(/sara|qahtani|900123|omar@/i);
    expect(logged).not.toMatch(/sara|qahtani|900123|omar@|\[CANDIDATE\]/i);

    // Excerpts are the stored text (offsets mapped back); model text shown to a recruiter has the name put back.
    const items = await as(ALEX, w1, (ctx) => evidence.listEvidenceForCandidate(ctx, sara, JOB));
    const cited = items.filter((i) => i.competencies.some((c) => c.competencyId === LLM));
    expect(cited.map((i) => i.excerpt)).toContain("Sara's merchant assistant serves about 9,000 merchants");
    expect(cited.map((i) => i.limit)).toContain('Sara Al Qahtani shows the work described, not its scale.');
    expect(JSON.stringify(cited)).not.toMatch(/\[(?:CANDIDATE|EMAIL_\d|PHONE_\d)\]/);
  });
});
