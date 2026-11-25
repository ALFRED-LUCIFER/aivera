import { readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { assistantAnswerSchema } from './assistant.answer.ts';
import { explainRankingSchema } from './assessment.explainRanking.ts';
import { asksProtectedTrait, suggestQuestionsSchema } from './assessment.suggestQuestions.ts';
import { schemaRules } from '../citations.ts';
import { compareExcerptsSchema } from './evidence.compareExcerpts.ts';
import { MAP_TO_COMPETENCY_SYSTEM, mapToCompetencySchema } from './evidence.mapToCompetency.ts';
import { parseCvSchema } from './evidence.parseCv.ts';
import { detectDomainSchema } from './jobs.detectDomain.ts';
import { draftCompetenciesSchema } from './jobs.draftCompetencies.ts';

// AIV-P1-082: a rejected answer's failed rules are logged as `path:code` (citations.ts schemaRules, allowlisted as
// credalent.ai.schema_rules). That is safe only while every path segment is a declared key or a list position: no
// prompt schema may let the model choose a key (z.record, z.map, or an object with a catchall).

type Def = { type: string; [key: string]: unknown };
const defOf = (schema: unknown): Def => (schema as { def: Def }).def;

/** Every node type found under `schema`, with `catchall` for an object that accepts undeclared keys. */
function nodeTypes(schema: unknown, seen = new Set<unknown>()): string[] {
  if (!schema || seen.has(schema)) return [];
  seen.add(schema);
  const def = defOf(schema);
  const children = [
    ...Object.values((def.shape as Record<string, unknown> | undefined) ?? {}),
    def.element,
    def.innerType,
    def.in,
    def.out,
    def.keyType,
    def.valueType,
    ...((def.options as unknown[] | undefined) ?? []),
  ];
  const catchall = def.type === 'object' && def.catchall && defOf(def.catchall).type !== 'never' ? ['catchall'] : [];
  return [def.type, ...catchall, ...children.flatMap((child) => nodeTypes(child, seen))];
}

const SCHEMAS: [string, z.ZodType][] = [
  ['jobs.draftCompetencies', draftCompetenciesSchema],
  ['jobs.detectDomain', detectDomainSchema({ domains: ['payments'], regions: ['gcc'] })],
  ['evidence.parseCv', parseCvSchema],
  ['evidence.mapToCompetency', mapToCompetencySchema],
  ['evidence.compareExcerpts', compareExcerptsSchema],
  ['assistant.answer', assistantAnswerSchema],
  ['assessment.explainRanking', explainRankingSchema],
  ['assessment.suggestQuestions', suggestQuestionsSchema(['C1'])],
];

// Node types the walker knows to have only declared keys below them. Anything else (record, map, catchall, and any type
// the walker does not descend into, such as intersection, lazy or tuple) fails until someone checks it on purpose.
const KNOWN = new Set([
  'object',
  'array',
  'string',
  'number',
  'boolean',
  'enum',
  'literal',
  'null',
  'nullable',
  'optional',
  'default',
  'union',
  'pipe',
  'transform',
  'never',
]);

describe('prompt schemas declare every key (AIV-P1-082)', () => {
  // SAFETY: mutation check: added `extra: z.record(z.string(), z.string())` to draftCompetenciesSchema -> this test failed
  // SAFETY: mutation check: added `extra: z.intersection(z.object({}), z.record(z.string(), z.string()))` -> failed
  it.each(SCHEMAS)('%s has only node types with declared keys', (_, schema) => {
    const types = nodeTypes(schema);
    expect(types).toContain('object');
    expect(types.filter((t) => !KNOWN.has(t))).toEqual([]);
  });

  // SAFETY: mutation check: added an empty prompts/jobs.newTask.ts -> this test failed
  it('every prompt file in this folder is in the list', () => {
    const files = readdirSync(import.meta.dirname).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));
    expect(files.map((f) => f.replace(/\.ts$/, '')).toSorted()).toEqual(SCHEMAS.map(([name]) => name).toSorted());
  });
});

// AIV-P2-080: the mapping prompt's strength rules. Source text as data is the shared UNTRUSTED_CONTENT_RULES, which
// the client appends to every task (evals/eval.test.ts pins it).
describe('evidence.mapToCompetency prompt (AIV-P2-080)', () => {
  it('states the CV, document and repository-name rules and quotes around placeholders', () => {
    expect(MAP_TO_COMPETENCY_SYSTEM).toContain('Every citation of the link is in a cv source');
    expect(MAP_TO_COMPETENCY_SYSTEM).toContain('"strength": "supporting" with "label": "claim"');
    expect(MAP_TO_COMPETENCY_SYSTEM).toContain('a portal submission): "medium", label "submitted"');
    expect(MAP_TO_COMPETENCY_SYSTEM).toContain('its name alone is never evidence of a competency');
    expect(MAP_TO_COMPETENCY_SYSTEM).toContain('A quote never contains a placeholder');
  });
});

// AIV-P1-113: the structure rules of a suggested question, each named on telemetry in place of zod's `custom`.
const wordsOf = (n: number) => `How ${Array.from({ length: n - 1 }, () => 'far').join(' ')}`;
const suggested = (more: object = {}) => ({
  text: 'How was the 71% measured, on which questions, and who built that set?',
  strongAnswer: 'Names the set and who built it.',
  weakAnswer: 'Repeats the figure.',
  citations: [{ sourceId: 'S1', quote: 'from 71% to 88%' }],
  ...more,
});
const rulesOf = (first: object, competencyId = 'C1') => {
  const parsed = suggestQuestionsSchema(['C1', 'C2']).safeParse({
    gaps: [{ competencyId, questions: [first, suggested()] }],
  });
  return parsed.success ? [] : schemaRules(parsed.error.issues);
};

describe('assessment.suggestQuestions schema (AIV-P1-113)', () => {
  it('accepts an open question of 30 words with notes of 25', () => {
    expect(rulesOf(suggested({ text: wordsOf(30), strongAnswer: wordsOf(25), weakAnswer: wordsOf(25) }))).toEqual([]);
  });

  // SAFETY: mutation check: removed the question_too_long refine -> this test failed (the 31-word row parsed)
  it('a 31-word question and a 26-word note are too long, each named by its field', () => {
    expect(rulesOf(suggested({ text: wordsOf(31) }))).toEqual(['gaps.0.questions.0.text:question_too_long']);
    expect(rulesOf(suggested({ strongAnswer: wordsOf(26) }))).toEqual([
      'gaps.0.questions.0.strongAnswer:note_too_long',
    ]);
    expect(rulesOf(suggested({ weakAnswer: wordsOf(26) }))).toEqual(['gaps.0.questions.0.weakAnswer:note_too_long']);
  });

  it.each([
    'Did you build the evaluation set?',
    'Have you run this in production?',
    'Is the 71% figure yours?',
    "Wasn't that the team's work?",
    'Can you explain the figure?',
  ])('%j can be answered with yes or no: not open', (text) => {
    expect(rulesOf(suggested({ text }))).toEqual(['gaps.0.questions.0.text:question_not_open']);
  });

  it.each([
    'How was the 71% measured?',
    'Walk me through the evaluation set.',
    'Describe what you changed yourself.',
    'Which decision did the result change?',
    'Tell me about the hardest failure.',
  ])('%j is open', (text) => {
    expect(rulesOf(suggested({ text }))).toEqual([]);
  });

  it('a competency that is not a listed gap, one question only, and more gaps than listed are refused', () => {
    expect(rulesOf(suggested(), 'C9')).toEqual(['gaps.0.competencyId:competency_not_gap']);
    const schema = suggestQuestionsSchema(['C1']);
    expect(schema.safeParse({ gaps: [{ competencyId: 'C1', questions: [suggested()] }] }).success).toBe(false);
    const two = { competencyId: 'C1', questions: [suggested(), suggested()] };
    expect(schema.safeParse({ gaps: [two] }).success).toBe(true);
    expect(schema.safeParse({ gaps: [two, two] }).success).toBe(false);
  });

  it('a question with no citation is refused', () => {
    expect(rulesOf(suggested({ citations: [] }))).toEqual(['gaps.0.questions.0.citations:too_small']);
  });

  it('asks about the work, never a protected trait; words of the work itself are not traits', () => {
    for (const text of ['How old are you?', 'What is your nationality?', 'How is your family settling in?'])
      expect(asksProtectedTrait(text), text).toBe(true);
    for (const text of [
      'How did you fix the race condition in the health check?',
      'Which model family did you compare, and how did the age of the data matter?',
    ])
      expect(asksProtectedTrait(text), text).toBe(false);
    expect(rulesOf(suggested({ text: 'What does your religion mean for working hours?' }))).toEqual([
      'gaps.0.questions.0.text:protected_trait',
    ]);
  });
});
