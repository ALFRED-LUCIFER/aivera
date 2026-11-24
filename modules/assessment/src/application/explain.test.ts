import { createAiClient, fakeProvider, memoryTokenBudget } from '@credalent/ai';
import type { EvidenceItemView } from '@credalent/evidence';
import type { WorkspaceContext } from '@credalent/workspaces';
import { describe, expect, it } from 'vitest';
import { assess } from '../domain/assess.ts';
import type { Ports, StoredAssessment } from './assessment.ts';
import { explainUseCases, type ExplainPorts, type ExplanationStore } from './explain.ts';

// Sara Al Qahtani (synthetic): the two heaviest competencies rest on checked repositories, two rest on claims.
const JOB = 'job-sae';
const day = new Date('2026-11-10T08:00:00.000Z');
const NAMES: [string, string, number][] = [
  ['c-retrieval', 'Retrieval and evaluation', 25],
  ['c-llm', 'LLM systems in production', 20],
  ['c-python', 'Python service engineering', 15],
  ['c-pipelines', 'Data pipelines', 15],
  ['c-cost', 'Cost and reliability', 15],
  ['c-arabic', 'Arabic NLP', 10],
];
const RUBRIC = {
  versionId: 'rubric-v2',
  competencies: NAMES.map(([id, , weightPercent]) => ({
    id,
    weightPercent,
    levelNeeded: 3,
    type: 'mandatory' as const,
  })),
};
const item = (
  id: string,
  competencyId: string,
  kind: 'repository' | 'document' | 'cv',
  label: string,
  excerpt: string,
  strength: 'strong' | 'medium' | 'supporting',
  provenance: 'corroborated' | 'submitted' | 'claim',
  level: number,
): EvidenceItemView => ({
  id,
  workspaceId: 'w1',
  sourceId: `src-${id}`,
  candidateId: 'sara',
  excerpt,
  excerptSpan: null,
  provenance,
  strength,
  limit: 'Shows the tooling only.',
  synthetic: true,
  createdAt: day,
  source: {
    id: `src-${id}`,
    workspaceId: 'w1',
    candidateId: 'sara',
    kind,
    label,
    url: null,
    blobFileId: null,
    capturedAt: day,
    checkedAt: null,
    checkMethod: null,
    textFingerprint: null,
    synthetic: true,
    createdAt: day,
  },
  competencies: [{ jobId: JOB, competencyId, level }],
});
const EVIDENCE = [
  item(
    'e1',
    'c-retrieval',
    'repository',
    'llm-eval-harness',
    'llm-eval-harness: authored 412 of 460 commits.',
    'strong',
    'corroborated',
    5,
  ),
  item(
    'e2',
    'c-llm',
    'repository',
    'rag-service',
    'rag-service: authored 120 of 180 commits.',
    'strong',
    'corroborated',
    4,
  ),
  item('e3', 'c-python', 'document', 'Design doc', 'Designed the ingestion service.', 'medium', 'submitted', 3),
  item(
    'e4',
    'c-pipelines',
    'document',
    'Pipeline write-up',
    'Built nightly batch pipelines.',
    'medium',
    'submitted',
    3,
  ),
  item('e5', 'c-cost', 'cv', 'CV', 'Cut cost per request by 40%.', 'supporting', 'claim', 2),
  item('e6', 'c-arabic', 'cv', 'CV', 'Shipped Arabic query handling.', 'supporting', 'claim', 2),
];
const snapshot = (id: string): StoredAssessment => ({
  ...assess(
    RUBRIC,
    EVIDENCE.map((e) => ({
      itemId: e.id,
      competencyId: e.competencies[0]?.competencyId ?? '',
      level: e.competencies[0]?.level ?? 0,
      strength: e.strength,
      provenance: e.provenance,
    })),
  ),
  id,
  workspaceId: 'w1',
  candidateId: 'sara',
  jobId: JOB,
  assessedAt: day,
});

const ctx = { userId: 'ap', workspaceId: 'w1', role: 'recruiter', tx: {} } as unknown as WorkspaceContext;

/** The explanation over in-memory ports; `answer` is the model's raw output, `failure` a provider status for every attempt. */
function setup(
  answer: unknown,
  { failure, latest = snapshot('r1') }: { failure?: number; latest?: StoredAssessment | null } = {},
) {
  const cache = new Map<string, unknown>();
  const calls = { model: 0 };
  const store: ExplanationStore = {
    get: async (_w, resultId, version) => (cache.get(`${resultId} ${version}`) as never) ?? null,
    put: async (row) => void cache.set(`${row.resultId} ${row.promptVersion}`, row.statements),
  };
  const provider = fakeProvider({
    completion: JSON.stringify(answer),
    ...(failure && { failures: [failure, failure, failure] }),
  });
  const real = createAiClient({ provider, budget: memoryTokenBudget(), sleep: async () => {} });
  const ai: ExplainPorts['ai'] = { generateStructured: (input) => (calls.model++, real.generateStructured(input)) };
  const state = { latest };
  const useCases = explainUseCases({
    storeFor: () => ({ latest: async () => state.latest }) as never,
    authorize: async () => {},
    candidateJob: async () => ({ jobId: JOB, clientId: null }),
    now: () => day,
    explanationsFor: () => store,
    ai,
    approvedRubric: async () => ({ id: 'rubric-v2', competencies: NAMES.map(([id, name]) => ({ id, name })) }),
    evidence: async () => EVIDENCE,
    identifiersOf: async () => ({ names: ['Sara Al Qahtani'], emails: [], phones: [] }),
  } as unknown as ExplainPorts & Ports);
  return { useCases, calls, state };
}

const cite = (sourceId: string, quote: string) => ({ sourceId, quote });
// S1 is the facts source; S2 onward are the cited items, heaviest competency first (e1, e2, e3, e4).
const GOOD = {
  statements: [
    {
      text: 'The {checkedCount} heaviest competencies, {checkedWeight} of the weight, are backed by work that was independently checked.',
      citations: [cite('S1', 'Independently checked work backs the heaviest competencies')],
    },
    { text: 'The candidate authored most of the evaluation harness.', citations: [cite('S2', '412 of 460 commits')] },
    {
      text: '{claimCount} competencies, {claimWeight} of the weight, still rest on claims: {claimNames}.',
      citations: [cite('S1', 'Still resting on claims')],
    },
  ],
};

describe("Scenario: Sara's explanation", () => {
  it('says what the ticket says, with every number from the snapshot, and cites the source', async () => {
    const { useCases } = setup(GOOD);
    const explained = await useCases.explainRanking(ctx, 'sara', JOB);
    expect(explained?.source).toBe('ai');
    expect(explained?.statements.map((s) => s.text)).toEqual([
      'The two heaviest competencies, 45% of the weight, are backed by work that was independently checked.',
      'The candidate authored most of the evaluation harness.',
      'Two competencies, 25% of the weight, still rest on claims: Cost and reliability, and Arabic NLP.',
    ]);
    expect(explained?.statements[1]?.citations).toEqual([
      { itemId: 'e1', label: 'llm-eval-harness', quote: '412 of 460 commits' },
    ]);
    expect(explained?.statements[0]?.citations[0]?.itemId).toBeNull();
  });
});

describe('Scenario: Numbers come from the snapshot', () => {
  // SAFETY: mutation check: removed the digit and number-word refine from explainText -> this test failed (the 60% text was shown)
  it.each(['60% of the weight', 'sixty percent of the weight', 'Two competencies rest on claims', 'A {madeUp} share'])(
    'rejects the model text %j and shows the template',
    async (text) => {
      const { useCases } = setup({ statements: [{ text, citations: [cite('S1', 'Still resting on claims')] }] });
      const explained = await useCases.explainRanking(ctx, 'sara', JOB);
      expect(explained?.source).toBe('template');
      expect(JSON.stringify(explained)).not.toContain('60%');
    },
  );
});

describe('Scenario: A statement without a citation is dropped', () => {
  // SAFETY: mutation check: kept statements with no citations in explainRanking -> this test failed (3 statements shown)
  it('removes it and keeps the cited ones', async () => {
    const { useCases } = setup({
      statements: [...GOOD.statements.slice(1), { text: 'The candidate is a strong hire.', citations: [] }],
    });
    const explained = await useCases.explainRanking(ctx, 'sara', JOB);
    expect(explained?.source).toBe('ai');
    expect(explained?.statements).toHaveLength(2);
    expect(explained?.statements.every((s) => s.citations.length > 0)).toBe(true);
  });

  it('rejects an answer quoting words that are not in the source, and shows the template', async () => {
    const { useCases } = setup({
      statements: [{ text: 'Work is checked.', citations: [cite('S2', 'authored all 460 commits')] }],
    });
    expect((await useCases.explainRanking(ctx, 'sara', JOB))?.source).toBe('template');
  });
});

describe('Scenario: Model unavailable', () => {
  it('shows a template from the same facts, marked as not AI', async () => {
    const { useCases } = setup(GOOD, { failure: 503 });
    const explained = await useCases.explainRanking(ctx, 'sara', JOB);
    expect(explained?.source).toBe('template');
    expect(explained?.statements.map((s) => s.text)).toEqual([
      'Competencies carrying 45% of the weight are backed by work that was independently checked.',
      'The strongest cited work is llm-eval-harness.',
      'Competencies carrying 25% of the weight still rest on claims: Cost and reliability, and Arabic NLP.',
    ]);
    expect(explained?.statements.every((s) => s.citations.length > 0)).toBe(true);
  });
});

describe('Scenario: Explanation follows the snapshot', () => {
  it('is cached per snapshot id and written again for a new snapshot', async () => {
    const { useCases, calls, state } = setup(GOOD);
    await useCases.explainRanking(ctx, 'sara', JOB);
    await useCases.explainRanking(ctx, 'sara', JOB);
    expect(calls.model).toBe(1);
    state.latest = snapshot('r2');
    const next = await useCases.explainRanking(ctx, 'sara', JOB);
    expect(calls.model).toBe(2);
    expect(next?.resultId).toBe('r2');
  });

  it('is null with no snapshot', async () => {
    expect(await setup(GOOD, { latest: null }).useCases.explainRanking(ctx, 'sara', JOB)).toBeNull();
  });
});
