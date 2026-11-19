import {
  createAiClient,
  DRAFT_COMPETENCIES_SYSTEM,
  draftCompetenciesSchema,
  fakeProvider,
  UncitedOutput,
  type AiProvider,
} from '@aivera/ai';
import { describe, expect, it } from 'vitest';
import { competencyDrafting } from './draft-competencies.ts';

// Feature: Draft competencies from the job description (AIV-P1-008). The Senior AI Engineer demo job (personas.md).

const workspaceId = '0190d4a2-0000-7000-8000-000000000008';
const description = [
  'You will ship and run LLM assistants and retrieval systems that real merchants use every day.',
  'You will build the eval sets and retrieval metrics that decide what we ship.',
  'You will write production Python services, with tests, and deploy them yourself.',
  'You keep latency, cost per request and incidents in check.',
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
    const { competencies: drafted } = await setup(answer).drafting.draftCompetencies(workspaceId, input);
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
    await expect(drafting.draftCompetencies(workspaceId, input)).rejects.toBeInstanceOf(UncitedOutput);
    expect(prompts).toHaveLength(2);
  });

  it('refuses a weight, a level or a weight total out of range rather than patching it', () => {
    const bad = { ...answer, competencies: [{ ...answer.competencies[0], level: 6 }] };
    expect(draftCompetenciesSchema.safeParse(answer).success).toBe(true);
    expect(draftCompetenciesSchema.safeParse(bad).success).toBe(false);
    expect(
      draftCompetenciesSchema.safeParse({ ...answer, competencies: [{ ...answer.competencies[0], weight: 0 }] })
        .success,
    ).toBe(false);
    // Weights totalling over 100, as the prompt forbids.
    const heavy = answer.competencies.map((c) => ({ ...c, weight: 30 }));
    expect(draftCompetenciesSchema.safeParse({ ...answer, competencies: heavy }).success).toBe(false);
  });
});

describe('Scenario: No candidate data reaches the prompt', () => {
  it('sends only the job type, title and description, besides the fixed instructions', async () => {
    const { drafting, prompts } = setup(answer);
    await drafting.draftCompetencies(workspaceId, input);
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
        `<source id="S1" kind="job_description">\n${description}\n</source>`,
    );
  });
});

describe('Fairness: a line asking for something that is not a skill', () => {
  it('is reported as left out, so the recruiter is told', async () => {
    const refused = { ...answer, refused: true, reason: 'Nationality is not evidence of work, so it was left out.' };
    const draft = await setup(refused).drafting.draftCompetencies(workspaceId, input);
    expect(draft.leftOutNonSkill).toBe(true);
  });
});
