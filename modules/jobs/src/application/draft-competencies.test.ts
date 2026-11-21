import {
  createAiClient,
  DRAFT_COMPETENCIES_SYSTEM,
  draftCompetenciesSchema,
  fakeProvider,
  UncitedOutput,
  type AiProvider,
} from '@credalent/ai';
import { describe, expect, it } from 'vitest';
import { JobError } from '../domain/job.ts';
import { CATALOGUE_V1 } from '../infrastructure/catalogue-v1.fixture.ts';
import { competencyDrafting, type CompetencyDraft } from './draft-competencies.ts';

// Feature: Draft competencies from the job description (AIV-P1-008). The Senior AI Engineer demo job (personas.md).

const workspaceId = '0190d4a2-0000-7000-8000-000000000008';
const description = [
  'You will ship and run LLM assistants and retrieval systems that real merchants use every day.',
  'You will build the eval sets and retrieval metrics that decide what we ship.',
  'You will write production Python services, with tests, and deploy them yourself.',
  'You keep latency, cost per request and incidents in check.',
  'The assistant answers merchants in Arabic and English.',
].join(' ');
const input = { jobType: 'ai_llm_engineering', title: 'Senior AI Engineer', description } as const;

const row = (name: string, evidenceExpected: string, weight: number, level: number, type: string, quote: string) => ({
  name,
  evidenceExpected,
  weight,
  level,
  type,
  citations: [{ sourceId: 'S1', quote }],
});
const answer = {
  competencies: [
    row(
      'LLM systems in production',
      'A shipped assistant or RAG system with real users, and their part in it',
      25,
      4,
      'mandatory',
      'ship and run LLM assistants and retrieval systems that real merchants use every day',
    ),
    row(
      'Retrieval and evaluation',
      'Eval sets and retrieval metrics, and how they changed decisions',
      20,
      4,
      'mandatory',
      'build the eval sets and retrieval metrics that decide what we ship',
    ),
    row(
      'Python service engineering',
      'Production Python they wrote: services, tests, deployment',
      15,
      3,
      'mandatory',
      'write production Python services, with tests, and deploy them yourself',
    ),
    row(
      'Cost and reliability',
      'Numbers on latency, cost per request and incidents handled',
      15,
      2,
      'desirable',
      'You keep latency, cost per request and incidents in check',
    ),
  ],
  refused: false,
  reason: null,
  suggestions: [
    {
      ...row(
        'Arabic and bilingual NLP',
        'Work on Arabic or bilingual text: models, evals, tokenisation',
        10,
        2,
        'desirable',
        'The assistant answers merchants in Arabic and English',
      ),
      why: 'The assistant must answer in Arabic, but the description lists no language requirement.',
    },
    {
      ...row(
        'Product judgement',
        'Product decisions they shaped from evals or merchant feedback',
        15,
        3,
        'desirable',
        'build the eval sets and retrieval metrics that decide what we ship',
      ),
      why: 'Your evals decide what ships, but the description does not ask for judging what merchants need.',
    },
  ],
};

/** The fake model, recording every prompt it was sent. */
function setup(completion: unknown) {
  const prompts: string[] = [];
  const fake = fakeProvider({ completion: JSON.stringify(completion) });
  const provider: AiProvider = {
    ...fake,
    languageModel: (deployment) => {
      const model = fake.languageModel(deployment) as ReturnType<typeof fake.languageModel> & {
        doGenerate: (options: { prompt: unknown }) => Promise<unknown>;
      };
      const generate = model.doGenerate.bind(model);
      model.doGenerate = (options: { prompt: unknown }) => (
        prompts.push(JSON.stringify(options.prompt)),
        generate(options)
      );
      return model;
    },
  };
  const budget = { spentToday: async () => ({ spent: 0, limit: 1_000_000 }), add: async () => undefined };
  return { drafting: competencyDrafting(createAiClient({ provider, budget })), prompts };
}

describe('Scenario: Drafting the Senior AI Engineer description', () => {
  it('returns the four stated competencies with weight, level and type, from the description', async () => {
    const { competencies: drafted, leftOutNonSkill } = await setup(answer).drafting.draftCompetencies(
      workspaceId,
      input,
      CATALOGUE_V1,
    );
    expect(leftOutNonSkill).toBe(false);
    expect(drafted.map((c) => [c.name, c.weightPercent, c.levelNeeded, c.type, c.origin])).toEqual([
      ['LLM systems in production', 25, 4, 'mandatory', 'from_description'],
      ['Retrieval and evaluation', 20, 4, 'mandatory', 'from_description'],
      ['Python service engineering', 15, 3, 'mandatory', 'from_description'],
      ['Cost and reliability', 15, 2, 'desirable', 'from_description'],
    ]);
  });
});

describe('Scenario: Every drafted competency cites the description', () => {
  it('links each competency to the exact span of the description it came from', async () => {
    const { competencies: drafted } = await setup(answer).drafting.draftCompetencies(workspaceId, input, CATALOGUE_V1);
    for (const [i, c] of drafted.entries()) {
      const [citation] = c.citations;
      expect(citation?.sourceId).toBe('description');
      expect(description.slice(citation?.start, citation?.end)).toBe(answer.competencies[i]?.citations[0]?.quote);
    }
  });

  // SAFETY: mutation check: removed cited() from draftCompetenciesSchema (packages/ai) -> this test failed (draft returned)
  it('rejects a model answer with a competency citing no line, after one retry', async () => {
    const uncited = { ...answer, competencies: [{ ...answer.competencies[0], citations: [] }] };
    const { drafting, prompts } = setup(uncited);
    await expect(drafting.draftCompetencies(workspaceId, input, CATALOGUE_V1)).rejects.toBeInstanceOf(UncitedOutput);
    expect(prompts).toHaveLength(2);
  });

  // SAFETY: mutation check: removed .max(8) on competencies and .max(400) on evidenceExpected in draftCompetenciesSchema
  // -> this test failed
  it('refuses a weight, a level, a list or a text out of range rather than patching it', () => {
    const first = answer.competencies[0];
    expect(draftCompetenciesSchema.safeParse(answer).success).toBe(true);
    for (const broken of [
      { ...first, level: 6 },
      { ...first, weight: 0 },
      { ...first, weight: 101 },
      { ...first, name: 'n'.repeat(121) },
      { ...first, evidenceExpected: 'e'.repeat(401) },
    ])
      expect(draftCompetenciesSchema.safeParse({ ...answer, competencies: [broken] }).success).toBe(false);
    const nine = Array.from({ length: 9 }, (_, i) => ({ ...first, name: `Competency ${i}` }));
    expect(draftCompetenciesSchema.safeParse({ ...answer, competencies: nine }).success).toBe(false);
  });
});

describe('Scenario: No candidate data reaches the prompt', () => {
  it('sends only the job type, title and description, besides the fixed instructions', async () => {
    const { drafting, prompts } = setup(answer);
    await drafting.draftCompetencies(workspaceId, input, CATALOGUE_V1);
    const [sent] = prompts;
    const messages = JSON.parse(sent ?? '[]') as { role: string; content: string | { text: string }[] }[];
    const text = (m: (typeof messages)[number]) =>
      typeof m.content === 'string' ? m.content : m.content.map((p) => p.text).join('');
    const user = messages
      .filter((m) => m.role === 'user')
      .map(text)
      .join('');
    const system = messages.find((m) => m.role === 'system');
    expect(system && text(system)).toContain(DRAFT_COMPETENCIES_SYSTEM);
    // The citation rules and the numbered source wrapper are the AI package's; what varies is exactly our three fields.
    expect(user).toBe(
      `Job type: ai_llm_engineering\nTitle: Senior AI Engineer\n\nSources:\n` +
        `<source id="S1" kind="job_description" trust="untrusted">\n${description}\n</source>`,
    );
  });
});

describe('Fairness: a line asking for something that is not a skill', () => {
  it('is reported as left out, so the recruiter is told', async () => {
    const refused = { ...answer, refused: true, reason: 'Nationality is not evidence of work, so it was left out.' };
    const draft = await setup(refused).drafting.draftCompetencies(workspaceId, input, CATALOGUE_V1);
    expect(draft.leftOutNonSkill).toBe(true);
  });
});

describe('Scenario: A suggestion explains itself (AIV-P1-009)', () => {
  it('returns the suggestions with why, evidence expected, weight, level and type, marked Suggested by Credalent', async () => {
    const { suggestions } = await setup(answer).drafting.draftCompetencies(workspaceId, input, CATALOGUE_V1);
    expect(suggestions.map((s) => [s.name, s.why, s.evidenceExpected, s.weightPercent, s.levelNeeded, s.type])).toEqual(
      [
        [
          'Arabic and bilingual NLP',
          'The assistant must answer in Arabic, but the description lists no language requirement.',
          'Work on Arabic or bilingual text: models, evals, tokenisation',
          10,
          2,
          'desirable',
        ],
        [
          'Product judgement',
          'Your evals decide what ships, but the description does not ask for judging what merchants need.',
          'Product decisions they shaped from evals or merchant feedback',
          15,
          3,
          'desirable',
        ],
      ],
    );
    // Scenario: Kept suggestions are marked: the origin the rubric stores (AIV-P1-010 saves it).
    expect(suggestions.map((s) => s.origin)).toEqual(['suggested_by_aivera', 'suggested_by_aivera']);
    const [citation] = suggestions[0]?.citations ?? [];
    expect(description.slice(citation?.start, citation?.end)).toBe(
      'The assistant answers merchants in Arabic and English',
    );
  });

  it('Scenario: Suggestions never duplicate drafted competencies', async () => {
    const duplicate = { ...answer, suggestions: [{ ...answer.suggestions[1], name: 'Cost and reliability' }] };
    const { suggestions } = await setup(duplicate).drafting.draftCompetencies(workspaceId, input, CATALOGUE_V1);
    expect(suggestions).toEqual([]);
  });

  it('Scenario: No suggestions', async () => {
    const { suggestions } = await setup({ ...answer, suggestions: [] }).drafting.draftCompetencies(
      workspaceId,
      input,
      CATALOGUE_V1,
    );
    expect(suggestions).toEqual([]);
  });

  // SAFETY: mutation check: removed cited() from the suggestions in draftCompetenciesSchema -> this test failed
  it('rejects a suggestion citing no line of the description, after one retry', async () => {
    const uncited = { ...answer, suggestions: [{ ...answer.suggestions[0], citations: [] }] };
    const { drafting, prompts } = setup(uncited);
    await expect(drafting.draftCompetencies(workspaceId, input, CATALOGUE_V1)).rejects.toBeInstanceOf(UncitedOutput);
    expect(prompts).toHaveLength(2);
  });

  it('refuses more than two suggestions, or a why over 400 characters, rather than trimming', () => {
    const three = { ...answer, suggestions: [...answer.suggestions, { ...answer.suggestions[0], name: 'Third' }] };
    expect(draftCompetenciesSchema.safeParse(three).success).toBe(false);
    const long = { ...answer, suggestions: [{ ...answer.suggestions[0], why: 'w'.repeat(401) }] };
    expect(draftCompetenciesSchema.safeParse(long).success).toBe(false);
  });
});

const total = (draft: CompetencyDraft) =>
  [...draft.competencies, ...draft.suggestions].reduce((sum, c) => sum + c.weightPercent, 0);

describe('Scenario: The drafted weights total 100 (AIV-P1-082)', () => {
  // SAFETY: mutation check: removed rebalanceWeights from draftCompetencies -> both tests here failed (180, 75)
  it('scales relative weights over or under 100 to total 100, in proportion, competencies and suggestions together', async () => {
    const heavy = {
      ...answer,
      competencies: answer.competencies.map((c) => ({ ...c, weight: 30 })),
      suggestions: answer.suggestions.map((s) => ({ ...s, weight: 30 })),
    };
    const scaled = await setup(heavy).drafting.draftCompetencies(workspaceId, input, CATALOGUE_V1);
    expect(total(scaled)).toBe(100);
    expect([...scaled.competencies, ...scaled.suggestions].map((c) => c.weightPercent)).toEqual([
      20, 16, 16, 16, 16, 16,
    ]);
    // 10, 20 and 30 of 60: rounded down to 16, 33 and 50, the remainder to the heaviest.
    const light = answer.competencies.slice(0, 3).map((c, i) => ({ ...c, weight: 10 * (i + 1) }));
    const raised = await setup({ ...answer, competencies: light, suggestions: [] }).drafting.draftCompetencies(
      workspaceId,
      input,
      CATALOGUE_V1,
    );
    expect(raised.competencies.map((c) => c.weightPercent)).toEqual([16, 33, 51]);
  });

  it('keeps weights that already total 100, and counts only the suggestions it keeps', async () => {
    const kept = await setup(answer).drafting.draftCompetencies(workspaceId, input, CATALOGUE_V1);
    expect(total(kept)).toBe(100);
    const duplicate = { ...answer, suggestions: [{ ...answer.suggestions[1], name: 'Cost and reliability' }] };
    const deduped = await setup(duplicate).drafting.draftCompetencies(workspaceId, input, CATALOGUE_V1);
    expect(deduped.suggestions).toEqual([]);
    expect(total(deduped)).toBe(100);
  });
});

describe('Scenario: Server validation follows the catalogue (AIV-P2-044)', () => {
  // SAFETY: mutation check: removed the offeredJobTypes check in draftCompetencies -> this test failed
  it('refuses a job type the published catalogue does not offer, before any model call', async () => {
    const { drafting, prompts } = setup(answer);
    const retired = { ...CATALOGUE_V1, jobTypes: CATALOGUE_V1.jobTypes.map((t) => ({ ...t, retired: true })) };
    for (const [jobType, catalogue] of [
      ['astrology', CATALOGUE_V1],
      ['ai_llm_engineering', retired],
    ] as const)
      await expect(drafting.draftCompetencies(workspaceId, { ...input, jobType }, catalogue)).rejects.toMatchObject(
        new JobError('job_type'),
      );
    expect(prompts).toEqual([]);
  });
});
