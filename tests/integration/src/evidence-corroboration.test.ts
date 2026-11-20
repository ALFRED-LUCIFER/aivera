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
import { createCandidates } from '@credalent/candidates/composition';
import { createDb, withWorkspace, type Db } from '@credalent/db';
import { newEnvelope } from '@credalent/db/outbox';
import type { Handler } from '@credalent/db/consumer';
import { EvidenceMappingRequestedV1, type EvidenceContract, type SourceKind } from '@credalent/evidence';
import { createEvidence, createEvidenceMappingHandlers } from '@credalent/evidence/composition';
import { ForbiddenError, type WorkspaceContext, type WorkspacesContract } from '@credalent/workspaces';
import { createWorkspaces } from '@credalent/workspaces/composition';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// AIV-P1-029 acceptance scenarios against real PostgreSQL as aivera_app: the mapping job (`evidence.mapping`) with the
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
  assessment = createAssessment(workspaces, audit, () => NOW);
  const fake = fakeProvider();
  handlers = createEvidenceMappingHandlers({
    ai: createAiClient({
      provider: { ...fake, languageModel: (d) => fakeProvider({ completion }).languageModel(d) },
      budget: { spentToday: async () => ({ spent: 0, limit: 10_000_000 }), add: async () => {} },
      sleep: async () => {},
    }),
    approvedRubric: async (_tx, _workspaceId, jobId) => (jobId === JOB ? { id: V1, competencies } : null),
    applications: { jobsForCandidate: async () => [JOB], candidatesForJob: async () => [] },
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
    expect((await linked(priya, LLM)).map((i) => i.provenance)).toEqual(['submitted', 'submitted']);
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
    expect((await linked(omar, LLM)).map((i) => i.provenance)).toEqual(['submitted', 'submitted']);

    // Reference notes copied from the write-up are the same origin too, so they confirm nothing.
    await reference(omar, COPIED);
    completion = answer(LLM, [
      [1, 'designed the refusal path'],
      [3, 'designed the refusal path'],
    ]);
    await mapNow(omar);
    expect((await linked(omar, LLM)).map((i) => i.provenance)).toEqual(['submitted', 'submitted']);
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

    // Self-merged: candidate-controlled evidence; the write-up stays Candidate-submitted.
    await withWorkspace(app, w1, (tx) =>
      tx.execute(sql`update evidence.merged_pull_request set merged_by = 'arjun-menon-example', self_merged = true
        where candidate_id = ${arjun}`),
    );
    await mapNow(arjun);
    expect((await linked(arjun, DISTRIBUTED)).map((i) => i.provenance)).toEqual(['submitted', 'submitted']);
  });

  describe('a pre-check contradiction', () => {
    let daniel: string;
    let contradictionId: string;

    it('Scenario: Conflicting numbers are flagged with both excerpts cited, and the backed score leaves them out', async () => {
      daniel = await person('Daniel Novak', 'daniel.novak@example.com');
      await record(daniel, 'document', 'Support assistant write-up', 'Raised 71% → 88% answer accuracy.');
      await record(daniel, 'interview_note', 'Round 1 scorecard', 'Interviewer noted answer accuracy was 80%.');
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
      // Resolving changes the comparison only: no event is written.
      expect(await outbox()).toEqual(mapped);
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
        ['submitted', 'The user count comes from her own write-up; the reference confirmed the scale only roughly.'],
        ['submitted', 'The user count comes from her own write-up; the reference confirmed the scale only roughly.'],
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
      expect((await linked(daniel, ACCURACY)).map((i) => i.provenance)).toEqual(['submitted', 'submitted']);
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
});
