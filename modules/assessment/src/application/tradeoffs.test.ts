import { createAiClient, fakeProvider, memoryTokenBudget } from '@credalent/ai';
import type { EvidenceItemView } from '@credalent/evidence';
import { ForbiddenError, type WorkspaceContext } from '@credalent/workspaces';
import { describe, expect, it } from 'vitest';
import { assess } from '../domain/assess.ts';
import { tradeoffFacts } from '../domain/tradeoffs.ts';
import type { StoredAssessment } from './assessment.ts';
import { tradeoffUseCases, type TradeoffPorts } from './tradeoffs.ts';

// Feature: Compare candidates side by side (AIV-P1-047), "The trade-offs". Synthetic: Sara Al Qahtani has checked
// retrieval work and an Arabic claim; Layla Haddad has the only checked Arabic work and nothing on retrieval.
const JOB = 'job-sae';
const day = new Date('2026-11-10T08:00:00.000Z');
const NAMES = new Map([
  ['c-retrieval', 'Retrieval and evaluation'],
  ['c-arabic', 'Arabic and bilingual NLP'],
]);
const RUBRIC = {
  versionId: 'rubric-v2',
  competencies: [
    { id: 'c-retrieval', weightPercent: 60, levelNeeded: 4, type: 'mandatory' as const },
    { id: 'c-arabic', weightPercent: 40, levelNeeded: 2, type: 'mandatory' as const },
  ],
};
const item = (
  id: string,
  candidateId: string,
  competencyId: string,
  excerpt: string,
  provenance: 'corroborated' | 'claim',
  level: number,
) =>
  ({
    id,
    candidateId,
    excerpt,
    provenance,
    strength: provenance === 'claim' ? 'supporting' : 'strong',
    source: { kind: provenance === 'claim' ? 'cv' : 'repository', label: provenance === 'claim' ? 'CV' : id },
    competencies: [{ jobId: JOB, competencyId, level }],
  }) as unknown as EvidenceItemView;
const EVIDENCE: Record<string, EvidenceItemView[]> = {
  sara: [
    item('e1', 'sara', 'c-retrieval', 'llm-eval-harness: authored 412 of 460 commits.', 'corroborated', 5),
    item('e2', 'sara', 'c-arabic', 'Describes a Gulf Arabic evaluation set.', 'claim', 2),
  ],
  layla: [item('e3', 'layla', 'c-arabic', 'Arabic OCR pipeline, public and documented.', 'corroborated', 5)],
};
const snapshot = (candidateId: string, rubricVersionId = 'rubric-v2'): StoredAssessment => ({
  ...assess(
    RUBRIC,
    (EVIDENCE[candidateId] ?? []).map((e) => ({
      itemId: e.id,
      competencyId: e.competencies[0]?.competencyId ?? '',
      level: e.competencies[0]?.level ?? 0,
      strength: e.strength,
      provenance: e.provenance,
    })),
  ),
  rubricVersionId,
  id: `r-${candidateId}`,
  workspaceId: 'w1',
  candidateId,
  jobId: JOB,
  assessedAt: day,
});

const ctx = { userId: 'ap', workspaceId: 'w1', role: 'recruiter', tx: {} } as unknown as WorkspaceContext;

function setup(answer: unknown, more: Partial<TradeoffPorts> & { failure?: number; stale?: string } = {}) {
  const { failure, stale, ...ports } = more;
  const calls = { model: 0, prompt: '' };
  const provider = fakeProvider({
    completion: JSON.stringify(answer),
    ...(failure && { failures: [failure, failure, failure] }),
  });
  const real = createAiClient({ provider, budget: memoryTokenBudget(), sleep: async () => {} });
  return {
    calls,
    ...tradeoffUseCases({
      storeFor: () =>
        ({
          latest: async (_w: string, id: string) =>
            EVIDENCE[id] ? snapshot(id, id === stale ? 'rubric-v1' : undefined) : null,
        }) as never,
      authorize: async () => {},
      candidateJob: async () => ({ jobId: JOB, clientId: null }),
      ai: {
        generateStructured: (input) => {
          calls.model++;
          calls.prompt = JSON.stringify(input.sources);
          return real.generateStructured(input);
        },
      },
      approvedRubric: async () => ({
        id: 'rubric-v2',
        competencies: [...NAMES].map(([id, name]) => ({ id, name })),
      }),
      evidence: async (_ctx, candidateId) => EVIDENCE[candidateId] ?? [],
      identifiersOf: async (_ctx, candidateId) => ({ names: [candidateId], emails: [], phones: [] }),
      ...ports,
    } as TradeoffPorts),
  };
}

const cite = (sourceId: string, quote: string) => ({ sourceId, quote });
// Sources as sent: S1 Sara's facts, S2 her harness (e1); S3 Layla's facts, S4 her pipeline (e3).
const SARA_CHECKED = 'is the only one compared with independently checked work on Retrieval and evaluation.';
const SARA_CLAIMS = 'still rests on claims for Arabic and bilingual NLP.';
const LAYLA_ONLY = 'is the only one compared with independently checked work on Arabic and bilingual NLP.';
const LAYLA_BELOW = 'is below the level the job needs on Retrieval and evaluation.';
const answerOf = (sara: object[], layla: object[]) => ({
  candidates: [
    { candidate: 'C1', statements: sara },
    { candidate: 'C2', statements: layla },
  ],
});
const GOOD = answerOf(
  [
    { text: SARA_CHECKED, citations: [cite('S1', SARA_CHECKED)] },
    {
      text: '[CANDIDATE] wrote most of an evaluation harness.',
      citations: [cite('S2', 'authored 412 of 460 commits')],
    },
  ],
  [{ text: LAYLA_ONLY, citations: [cite('S3', LAYLA_ONLY)] }],
);

describe('the facts of a comparison', () => {
  it('writes each comparison from the snapshots, as the rest of a sentence about the candidate', () => {
    const facts = tradeoffFacts([snapshot('sara'), snapshot('layla')], NAMES, [
      EVIDENCE['sara'] ?? [],
      EVIDENCE['layla'] ?? [],
    ]);
    expect(facts.map((f) => f.lines)).toEqual([
      [SARA_CHECKED, 'is below the level the job needs on Arabic and bilingual NLP.', SARA_CLAIMS],
      [LAYLA_ONLY, LAYLA_BELOW],
    ]);
    // Only the items behind a proven level are excerpts: Sara's Arabic claim (e2) is never one.
    expect(facts.map((f) => f.items.map((i) => i.id))).toEqual([['e1'], ['e3']]);
  });

  it('says "has", not "the only one", of work another compared candidate has checked too', () => {
    const both = [snapshot('layla'), { ...snapshot('layla'), candidateId: 'other' }];
    const facts = tradeoffFacts(both, NAMES, [EVIDENCE['layla'] ?? [], EVIDENCE['layla'] ?? []]);
    expect(facts[0]?.lines[0]).toBe('has independently checked work on Arabic and bilingual NLP.');
  });
});

describe('Scenario: Trade-offs cite evidence', () => {
  it("gives each candidate's statements in the order asked, each citing their own evidence or snapshot", async () => {
    const { compareTradeoffs, calls } = setup(GOOD);
    const written = await compareTradeoffs(ctx, JOB, ['sara', 'layla']);
    expect(written).toEqual({
      status: 'written',
      candidates: [
        {
          candidateId: 'sara',
          statements: [
            { text: SARA_CHECKED, citations: [{ itemId: null, label: 'Snapshot', quote: SARA_CHECKED }] },
            {
              text: 'The candidate wrote most of an evaluation harness.',
              citations: [{ itemId: 'e1', label: 'e1', quote: 'authored 412 of 460 commits' }],
            },
          ],
        },
        {
          candidateId: 'layla',
          statements: [{ text: LAYLA_ONLY, citations: [{ itemId: null, label: 'Snapshot', quote: LAYLA_ONLY }] }],
        },
      ],
    });
    // A claim's words never reach the model as work to describe.
    expect(calls.prompt).not.toContain('Gulf Arabic');
  });

  // SAFETY: mutation check: removed the cites_another_candidate issue from schemaFor -> this test failed (it was written)
  it("rejects an answer that rests one candidate's statement on another candidate's evidence", async () => {
    const crossed = answerOf(GOOD.candidates[0]?.statements ?? [], [
      { text: 'wrote most of an evaluation harness.', citations: [cite('S2', 'authored 412 of 460 commits')] },
    ]);
    expect(await setup(crossed).compareTradeoffs(ctx, JOB, ['sara', 'layla'])).toEqual({ status: 'unavailable' });
  });

  // SAFETY: mutation check: removed the every_candidate_once issue from schemaFor -> this test failed (both were written)
  it('rejects an answer that names a candidate twice or out of order, though every citation is their own', async () => {
    const [sara, layla] = GOOD.candidates;
    for (const keys of [
      ['C1', 'C1'],
      ['C2', 'C1'],
    ]) {
      const candidates = [
        { ...sara, candidate: keys[0] },
        { ...layla, candidate: keys[1] },
      ];
      expect(await setup({ candidates }).compareTradeoffs(ctx, JOB, ['sara', 'layla'])).toEqual({
        status: 'unavailable',
      });
    }
  });

  // SAFETY: mutation check: keptTradeoffs kept the model's text for a facts statement -> this test failed ("the strongest" was written)
  it("shows the snapshot's line for a facts statement, never the model's wording of it", async () => {
    const reworded = answerOf(
      [
        {
          text: 'has the strongest evidence of the candidates.',
          citations: [cite('S1', 'independently checked work')],
        },
      ],
      GOOD.candidates[1]?.statements ?? [],
    );
    const written = await setup(reworded).compareTradeoffs(ctx, JOB, ['sara', 'layla']);
    expect(written?.status === 'written' && written.candidates[0]?.statements.map((s) => s.text)).toEqual([
      SARA_CHECKED,
    ]);
    expect(JSON.stringify(written)).not.toContain('strongest');
  });

  it('rejects a facts citation whose quote is no line of the facts', async () => {
    const twoLines = answerOf(
      [{ text: SARA_CHECKED, citations: [cite('S1', `${SARA_CHECKED} is below`)] }],
      GOOD.candidates[1]?.statements ?? [],
    );
    expect(await setup(twoLines).compareTradeoffs(ctx, JOB, ['sara', 'layla'])).toEqual({ status: 'unavailable' });
  });

  // SAFETY: mutation check: removed the OVERSTATES test from keptTradeoffs -> this test failed ("proven" was written)
  it('drops a statement that calls work proven, and shows nothing when that leaves a candidate with none', async () => {
    const proven = { text: 'has proven Arabic work.', citations: [cite('S4', 'Arabic OCR pipeline')] };
    const kept = answerOf(GOOD.candidates[0]?.statements ?? [], [...(GOOD.candidates[1]?.statements ?? []), proven]);
    const written = await setup(kept).compareTradeoffs(ctx, JOB, ['sara', 'layla']);
    expect(JSON.stringify(written)).not.toContain('proven');
    expect(written?.status).toBe('written');
    const only = answerOf(GOOD.candidates[0]?.statements ?? [], [proven]);
    expect(await setup(only).compareTradeoffs(ctx, JOB, ['sara', 'layla'])).toEqual({ status: 'unavailable' });
  });

  it('rejects a figure the statement does not quote from the work it cites', async () => {
    const invented = answerOf(
      [{ text: 'wrote 900 commits.', citations: [cite('S2', 'authored 412 of 460 commits')] }],
      GOOD.candidates[1]?.statements ?? [],
    );
    expect(await setup(invented).compareTradeoffs(ctx, JOB, ['sara', 'layla'])).toEqual({ status: 'unavailable' });
  });
});

describe('Scenario: Trade-offs unavailable', () => {
  it('says so when the model is unavailable', async () => {
    const { compareTradeoffs, calls } = setup(GOOD, { failure: 503 });
    expect(await compareTradeoffs(ctx, JOB, ['sara', 'layla'])).toEqual({ status: 'unavailable' });
    expect(calls.model).toBe(1);
  });

  // SAFETY: mutation check: removed the unknownPerson return from compareTradeoffs -> this test failed (the model was called)
  it('sends nothing when one candidate has no identifiers to redact', async () => {
    const { compareTradeoffs, calls } = setup(GOOD, {
      identifiersOf: async (_ctx, id) => (id === 'layla' ? undefined : { names: [id], emails: [], phones: [] }),
    });
    expect(await compareTradeoffs(ctx, JOB, ['sara', 'layla'])).toEqual({ status: 'unavailable' });
    expect(calls.model).toBe(0);
  });
});

describe('who and what may be compared', () => {
  it.each([
    ['one candidate', ['sara']],
    ['the same candidate twice', ['sara', 'sara']],
    ['more than ten', Array.from({ length: 11 }, (_, i) => `p${i}`)],
    ['a candidate with no snapshot', ['sara', 'nobody']],
  ])('is null for %s, and no model is called', async (_, ids) => {
    const { compareTradeoffs, calls } = setup(GOOD);
    expect(await compareTradeoffs(ctx, JOB, ids)).toBeNull();
    expect(calls.model).toBe(0);
  });

  it('is null while a candidate is still scored on an earlier rubric version', async () => {
    expect(await setup(GOOD, { stale: 'layla' }).compareTradeoffs(ctx, JOB, ['sara', 'layla'])).toBeNull();
  });

  // SAFETY: mutation check: removed the authorize call from compareTradeoffs -> this test failed (it resolved)
  it('refuses a member who may not view a candidate on the job, before any model call', async () => {
    const { compareTradeoffs, calls } = setup(GOOD, {
      authorize: async (_ctx, _action, resource) => {
        if (!resource) throw new ForbiddenError();
      },
      candidateJob: async (_ctx, id) => (id === 'sara' ? { jobId: JOB, clientId: null } : null),
    });
    await expect(compareTradeoffs(ctx, JOB, ['sara', 'layla'])).rejects.toBeInstanceOf(ForbiddenError);
    expect(calls.model).toBe(0);
  });
});
