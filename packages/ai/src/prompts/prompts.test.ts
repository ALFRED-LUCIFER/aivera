import { readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { assistantAnswerSchema } from './assistant.answer.ts';
import { compareTradeoffsSchema } from './assessment.compareTradeoffs.ts';
import { explainRankingSchema } from './assessment.explainRanking.ts';
import { asksProtectedTrait, suggestQuestionsSchema } from './assessment.suggestQuestions.ts';
import { schemaRules } from '../citations.ts';
import { compareExcerptsSchema } from './evidence.compareExcerpts.ts';
import { MAP_TO_COMPETENCY_SYSTEM, mapToCompetencySchema } from './evidence.mapToCompetency.ts';
import { parseCvSchema } from './evidence.parseCv.ts';
import { mapSummarySchema } from './interviews.mapSummary.ts';
import { summariseMemberSchema } from './decisions.summariseMember.ts';
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
  ['assessment.compareTradeoffs', compareTradeoffsSchema],
  ['assessment.suggestQuestions', suggestQuestionsSchema([{ id: 'C1', citable: ['S1'] }])],
  ['interviews.mapSummary', mapSummarySchema(['C1'])],
  ['decisions.summariseMember', summariseMemberSchema],
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
const cites = (sourceId: string) => suggested({ citations: [{ sourceId, quote: 'from 71% to 88%' }] });
// A gap answered with two questions: the first cites the gap's own evidence (C1: S1, C2: S2), the second `sourceId`.
const gap = (competencyId: string, sourceId: string) => ({
  competencyId,
  questions: [cites(competencyId === 'C1' ? 'S1' : 'S2'), cites(sourceId)],
});
const rulesOf = (first: object, competencyId = 'C1') => {
  const parsed = suggestQuestionsSchema([{ id: 'C1', citable: ['S1'] }]).safeParse({
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
    expect(rulesOf(suggested(), 'C9')).toContain('gaps.0.competencyId:competency_not_gap');
    const schema = suggestQuestionsSchema([{ id: 'C1', citable: ['S1'] }]);
    expect(schema.safeParse({ gaps: [{ competencyId: 'C1', questions: [suggested()] }] }).success).toBe(false);
    const two = { competencyId: 'C1', questions: [suggested(), suggested()] };
    expect(schema.safeParse({ gaps: [two] }).success).toBe(true);
    expect(schema.safeParse({ gaps: [two, two] }).success).toBe(false);
  });

  // Refused, so the client asks once more and logs the rule, never trimmed and stored (AGENTS.md 1.6, 3.7). C1 may
  // cite S1, C2 may cite S2; S3 is C2's notes, never cited.
  describe('each listed gap answered once, citing only its own evidence', () => {
    const schema = suggestQuestionsSchema([
      { id: 'C1', citable: ['S1'] },
      { id: 'C2', citable: ['S2'], notes: ['S3'] },
    ]);
    const rules = (gaps: object[]) => {
      const parsed = schema.safeParse({ gaps });
      return parsed.success ? [] : schemaRules(parsed.error.issues);
    };

    it('accepts every gap once, each citing its own evidence', () => {
      expect(rules([gap('C1', 'S1'), gap('C2', 'S2')])).toEqual([]);
    });

    // SAFETY: mutation check: removed the citation_not_gap check -> this test failed (the answer parsed)
    it("refuses a question citing another gap's evidence, or its gap's notes", () => {
      expect(rules([gap('C1', 'S2'), gap('C2', 'S2')])).toEqual([
        'gaps.0.questions.1.citations.0.sourceId:citation_not_gap',
      ]);
      expect(rules([gap('C1', 'S1'), gap('C2', 'S3')])).toEqual([
        'gaps.1.questions.1.citations.0.sourceId:citation_not_gap',
      ]);
    });

    // SAFETY: mutation check: removed the gap_missing check -> this test failed (the answer parsed)
    it('refuses an answer that leaves a listed gap out', () => {
      expect(rules([gap('C1', 'S1')])).toEqual(['gaps:gap_missing']);
    });

    it('refuses a gap answered twice', () => {
      expect(rules([gap('C1', 'S1'), gap('C1', 'S1')])).toEqual([
        'gaps.1.competencyId:gap_repeated',
        'gaps:gap_missing',
      ]);
    });
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
    // AIV-P1-161: a trait word written with a ligature or in fullwidth letters is the same word.
    // SAFETY: mutation check: tested the text unfolded in asksProtectedTrait -> these two assertions failed
    expect(asksProtectedTrait('What is your marital ﬆatus?')).toBe(true);
    expect(asksProtectedTrait('What is your ｎａｔｉｏｎａｌｉｔｙ?')).toBe(true);
    // SAFETY: mutation check: tested the folded text only (fold.ts matchesFolded) -> this assertion failed
    expect(asksProtectedTrait('What is your ageＸ')).toBe(true);
    expect(rulesOf(suggested({ text: 'What does your religion mean for working hours?' }))).toEqual([
      'gaps.0.questions.0.text:protected_trait',
    ]);
  });
});
