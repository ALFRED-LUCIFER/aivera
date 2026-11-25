import { readFileSync } from 'node:fs';
import { createAiClient, fakeProvider, memoryTokenBudget } from '@credalent/ai';
import type { EvidenceItemView } from '@credalent/evidence';
import type { WorkspaceContext } from '@credalent/workspaces';
import { describe, expect, it } from 'vitest';
import { assess } from '../domain/assess.ts';
import { citationOf, factsOf } from '../domain/explain.ts';
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
const snapshot = (id: string, items = EVIDENCE): StoredAssessment => ({
  ...assess(
    RUBRIC,
    items.map((e) => ({
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
  {
    failure,
    evidence = EVIDENCE,
    names = NAMES,
    latest = snapshot('r1', evidence),
  }: {
    failure?: number;
    latest?: StoredAssessment | null;
    evidence?: EvidenceItemView[];
    names?: [string, string, number][];
  } = {},
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
    approvedRubric: async () => ({ id: 'rubric-v2', competencies: names.map(([id, name]) => ({ id, name })) }),
    evidence: async () => evidence,
    identifiersOf: async () => ({ names: ['Sara Al Qahtani'], emails: [], phones: [] }),
  } as unknown as ExplainPorts & Ports);
  return { useCases, calls, state };
}

const cite = (sourceId: string, quote: string) => ({ sourceId, quote });
// S1 is the facts source; S2 onward are the cited items, heaviest competency first (e1, e2, e3, e4).
const CHECKED_LINE =
  'Independently checked work backs the heaviest competencies: Retrieval and evaluation, and LLM systems in production, {checkedWeight} of the weight.';
const CLAIMS_LINE = 'Still resting on claims: {claimNames}, {claimWeight} of the weight.';
// A statement citing the facts source is one of its lines, exactly (AIV-P1-132): the schema rejects a paraphrase.
const GOOD = {
  statements: [
    { text: CHECKED_LINE, citations: [cite('S1', 'Independently checked work backs')] },
    { text: 'The candidate authored most of the evaluation harness.', citations: [cite('S2', '412 of 460 commits')] },
    { text: CLAIMS_LINE, citations: [cite('S1', 'Still resting on claims')] },
  ],
};
// The model's own words reach the module's checks (statementAllowed, figuresQuoted) only on a statement citing an
// excerpt: S2 is llm-eval-harness.
const EXCERPT = 'llm-eval-harness';

describe("Scenario: Sara's explanation", () => {
  it('says what the ticket says, with every number from the snapshot, and cites the source', async () => {
    const { useCases } = setup(GOOD);
    const explained = await useCases.explainRanking(ctx, 'sara', JOB);
    expect(explained?.source).toBe('ai');
    expect(explained?.statements.map((s) => s.text)).toEqual([
      'Independently checked work backs the heaviest competencies: Retrieval and evaluation, and LLM systems in production, 45% of the weight.',
      'The candidate authored most of the evaluation harness.',
      'Still resting on claims: Cost and reliability, and Arabic NLP, 25% of the weight.',
    ]);
    expect(explained?.statements[1]?.citations).toEqual([
      { itemId: 'e1', label: 'llm-eval-harness', quote: '412 of 460 commits' },
    ]);
    expect(explained?.statements[0]?.citations[0]?.itemId).toBeNull();
  });
});

describe('Scenario: A reworded facts line is rejected, never shown', () => {
  // SAFETY: mutation check: explainRankingRequest given the static explainRankingSchema -> this test failed (the paraphrase was shown)
  it('falls back to the template, uncached, when a statement citing the facts source rewords its line', async () => {
    const reworded = {
      text: "The candidate's score is based on claims.",
      citations: [cite('S1', 'Still resting on claims')],
    };
    const { useCases, calls } = setup({ statements: [GOOD.statements[1], reworded] });
    const explained = await useCases.explainRanking(ctx, 'sara', JOB);
    expect(explained?.source).toBe('template');
    expect(JSON.stringify(explained)).not.toContain('based on claims');
    await useCases.explainRanking(ctx, 'sara', JOB);
    expect(calls.model).toBe(2);
  });
});

describe('Scenario: Numbers come from the snapshot', () => {
  // SAFETY: mutation check: removed the number-word refine from explainText -> this test failed (the number-word rows were shown)
  it.each([
    '60% of the weight',
    'sixty percent of the weight',
    'Two competencies rest on claims',
    'One competency rests on claims',
    'Both rest on claims',
    'Fifteen competencies rest on claims',
    'Hundreds of commits back it',
    'Worth a million',
    'Forty-five per cent of the weight',
    '٤٥٪ of the weight',
    '４５％ of the weight',
    'One of the competencies rests on claims',
    'One heavily weighted competency rests on claims',
    '{checkedWeight}% of the weight',
    'A {madeUp} share',
  ])('rejects the model text %j and shows the template', async (text) => {
    const { useCases } = setup({ statements: [{ text, citations: [cite('S2', EXCERPT)] }] });
    const explained = await useCases.explainRanking(ctx, 'sara', JOB);
    expect(explained?.source).toBe('template');
    expect(JSON.stringify(explained)).not.toContain('60%');
  });
});

// AIV-P1-132, owner decision 24 Nov 2026: a figure of the work only where the statement quotes it from its excerpt.
const answer = (text: string, sourceId: string, quote: string) => ({
  statements: [{ text, citations: [cite(sourceId, quote)] }],
});
describe('Scenario Outline: A number the model wrote is never shown', () => {
  it('shows a figure the statement quotes from the excerpt it cites', async () => {
    const text = 'The candidate authored 412 of 460 commits.';
    const { useCases } = setup(answer(text, 'S2', 'authored 412 of 460 commits'));
    const explained = await useCases.explainRanking(ctx, 'sara', JOB);
    expect(explained?.source).toBe('ai');
    expect(explained?.statements.map((s) => s.text)).toEqual([text]);
  });

  // SAFETY: mutation check: removed the quotesItsFigures refine from explainRankingSchema -> these tests failed (400 was shown)
  // (the facts-only row is now also rejected by the facts-line refine, AIV-P1-132)
  it.each([
    [
      'a figure the excerpt does not hold',
      'The cited repository shows 400 of 460 commits.',
      'S2',
      '412 of 460 commits',
    ],
    ['a figure citing the facts only', 'The candidate authored 412 of 460 commits.', 'S1', 'Still resting on claims'],
    ['a figure from another excerpt', 'The candidate authored 120 of 180 commits.', 'S2', '412 of 460 commits'],
  ])('rejects %s and shows the template', async (_, text, sourceId, quote) => {
    const { useCases } = setup(answer(text, sourceId, quote));
    const explained = await useCases.explainRanking(ctx, 'sara', JOB);
    expect(explained?.source).toBe('template');
    expect(JSON.stringify(explained)).not.toContain(text);
  });
});

describe('A figure is checked against the quote that is stored, not only the one the model wrote', () => {
  // SAFETY: mutation check: removed the figuresQuoted check in explainRanking -> this test failed ("18 months" was shown beside a quote without it)
  it('drops a statement whose figure stood in the part of the quote that redaction cut', async () => {
    const evidence = EVIDENCE.map((e) =>
      e.id === 'e1' ? { ...e, excerpt: 'Over 18 months, Sara Al Qahtani owned the on-call rota for the platform.' } : e,
    );
    const { useCases } = setup(
      answer(
        'Over 18 months the candidate owned the on-call rota.',
        'S2',
        'Over 18 months, [CANDIDATE] owned the on-call rota for the platform',
      ),
      { evidence },
    );
    const explained = await useCases.explainRanking(ctx, 'sara', JOB);
    expect(explained?.source).toBe('template');
    expect(JSON.stringify(explained)).not.toContain('18 months the candidate');
  });
});

describe('Scenario: The facts line holds placeholders, and a line copied from it is a valid statement', () => {
  const CHECKED =
    'Independently checked work backs the heaviest competencies: Retrieval and evaluation, and LLM systems in production, {checkedWeight} of the weight.';
  const CLAIMS = 'Still resting on claims: {claimNames}, {claimWeight} of the weight.';

  // SAFETY: mutation check: wrote values['checkedWeight'] back into the checked line of factsOf -> this test failed
  it("Sara's facts lines hold no figure, keep the figures as values, and are the golden case's facts source", () => {
    const facts = factsOf(snapshot('r1'), new Map(NAMES.map(([id, name]) => [id, name])), EVIDENCE);
    expect(facts.factsText).toBe(`${CHECKED}\n${CLAIMS}`);
    expect(facts.factsText).not.toMatch(/[\p{N}%]/u);
    expect(facts.values).toMatchObject({
      checkedWeight: '45%',
      claimWeight: '25%',
      claimNames: 'Cost and reliability, and Arabic NLP',
    });
    // So the eval set cannot drift from the code.
    const golden = readFileSync(
      new URL('../../../../packages/ai/evals/assessment.explainRanking/sara-heaviest-checked.yaml', import.meta.url),
      'utf8',
    );
    expect(golden).toContain(`${CHECKED}\n      ${CLAIMS}`);
  });

  // SAFETY: mutation check: citationOf returned the facts quote unfilled -> this test failed ({claimNames} was shown)
  it('accepts the copied line and shows the snapshot figures in its text and its facts quote, never a brace', async () => {
    const { useCases } = setup({ statements: [{ text: CLAIMS, citations: [cite('S1', CLAIMS)] }] });
    const explained = await useCases.explainRanking(ctx, 'sara', JOB);
    const shown = 'Still resting on claims: Cost and reliability, and Arabic NLP, 25% of the weight.';
    // The client trims the quote's final full stop.
    expect(explained).toMatchObject({
      source: 'ai',
      statements: [{ text: shown, citations: [{ itemId: null, label: 'Snapshot', quote: shown.slice(0, -1) }] }],
    });
  });

  // Defence only: a quote must be in the facts text, which holds no placeholder without a value.
  it('drops a facts quote whose placeholder the snapshot has no fact for', () => {
    const facts = { id: 'facts', label: 'Snapshot', kind: 'facts' as const, text: '' };
    expect(citationOf(facts, '{claimWeight} of the weight', {})).toBeNull();
    expect(citationOf(facts, '{claimWeight} of the weight', { claimWeight: '25%' })?.quote).toBe('25% of the weight');
  });

  // SAFETY: mutation check: removed the brace check in citationOf -> this test failed ("{claimWeight" was shown)
  it('drops a facts citation whose quote cuts a placeholder in half, and the statement it leaves uncited', async () => {
    const { useCases } = setup({
      statements: [{ text: CLAIMS, citations: [cite('S1', '{claimNames}, {claimWeight')] }],
    });
    const explained = await useCases.explainRanking(ctx, 'sara', JOB);
    expect(explained?.source).toBe('template');
    for (const s of explained?.statements ?? [])
      expect(s.text + s.citations.map((c) => c.quote).join('')).not.toMatch(/[{}]/);
  });
});

describe('Statements the facts do not support are dropped', () => {
  // SAFETY: mutation check: removed the `untrue` heaviest check in explainRanking -> this test failed (the false claim was shown)
  it('drops "heaviest" when the checked competencies are not the heaviest, and counts one claim as "one competency"', async () => {
    // Retrieval (25%) is only candidate-submitted here, so the checked LLM work (20%) is not the heaviest; Arabic NLP is no claim.
    const evidence = EVIDENCE.filter((e) => e.id !== 'e6').map((e) =>
      e.id === 'e1' ? { ...e, provenance: 'submitted' as const } : e,
    );
    const { useCases } = setup(
      {
        statements: [
          {
            text: 'The {checkedCompetencies}, {checkedWeight} of the weight, are the heaviest.',
            citations: [cite('S2', EXCERPT)],
          },
          { text: '{claimCompetencies} still rest on claims.', citations: [cite('S2', EXCERPT)] },
        ],
      },
      { evidence },
    );
    const explained = await useCases.explainRanking(ctx, 'sara', JOB);
    expect(explained?.source).toBe('ai');
    expect(explained?.statements.map((s) => s.text)).toEqual(['One competency still rest on claims.']);
  });
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
      'Two competencies carrying 45% of the weight are backed by work that was independently checked.',
      'The cited work behind Retrieval and evaluation is llm-eval-harness.',
      'Two competencies carrying 25% of the weight still rest on claims: Cost and reliability, and Arabic NLP.',
    ]);
    expect(explained?.statements.every((s) => s.citations.length > 0)).toBe(true);
  });
});

describe('The template never states what the facts do not', () => {
  // SAFETY: mutation check: template said "behind the heaviest competency" for the first cited item -> this test failed (Retrieval has only claims)
  it('names the competency the cited work backs, not the heaviest, when the heaviest has only claims', async () => {
    const evidence = EVIDENCE.map((e) =>
      e.id === 'e1' ? { ...e, strength: 'supporting' as const, provenance: 'claim' as const } : e,
    );
    const { useCases } = setup(GOOD, { failure: 503, evidence });
    const explained = await useCases.explainRanking(ctx, 'sara', JOB);
    expect(explained?.source).toBe('template');
    const texts = explained?.statements.map((s) => s.text) ?? [];
    expect(texts).toContain('The cited work behind LLM systems in production is rag-service.');
    expect(texts.join(' ')).not.toMatch(/heaviest/);
  });
});

const say = (text: string) => ({ text, citations: [cite('S2', EXCERPT)] });

describe('Rule 1.6 wording is enforced in code, not only asked of the model', () => {
  // Retrieval (25%) is only candidate-submitted here, so the checked work is not the heaviest.
  const evidence = EVIDENCE.map((e) => (e.id === 'e1' ? { ...e, provenance: 'submitted' as const } : e));

  // SAFETY: mutation check: statementAllowed always true -> this test failed (verified, proven and a "backed" claim were shown)
  // Here the checked work IS the heaviest (Sara's own evidence), so only a claim being "heaviest" is wrong.
  it('drops a statement calling the claims the heaviest, even when the checked work is', async () => {
    const { useCases } = setup({ statements: [say('{claimNames} are the heaviest.')] });
    expect((await useCases.explainRanking(ctx, 'sara', JOB))?.source).toBe('template');
  });

  it.each([
    ['verified', say('The work was independently verified.')],
    ['proven', say('The work is proven.')],
    ['a claim called backed', say('{claimNames} are backed.')],
    ['largest share when not the heaviest', say('This holds the largest share of the weight.')],
    ['a claim supported', say('{claimNames} are supported.')],
    ['a claim checked', say('{claimNames} have been checked.')],
  ])('drops a statement saying %s, leaving the template', async (_, statement) => {
    const { useCases } = setup({ statements: [statement] }, { evidence });
    expect((await useCases.explainRanking(ctx, 'sara', JOB))?.source).toBe('template');
  });
});

describe("A rubric competency named like a banned word is a server fact, not the model's claim", () => {
  // SAFETY: mutation check: statementAllowed tested the filled text instead of the model's own words -> this test failed (the claims line was dropped)
  it('keeps "still rest on claims: Test and verification"', async () => {
    const names = NAMES.map(([id, name, weight]): [string, string, number] => [
      id,
      id === 'c-cost' ? 'Test and verification' : name,
      weight,
    ]);
    const { useCases } = setup(
      {
        statements: [{ text: CLAIMS_LINE, citations: [cite('S1', 'Still resting on claims')] }],
      },
      { names },
    );
    const explained = await useCases.explainRanking(ctx, 'sara', JOB);
    expect(explained?.source).toBe('ai');
    expect(explained?.statements[0]?.text).toBe(
      'Still resting on claims: Test and verification, and Arabic NLP, 25% of the weight.',
    );
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
