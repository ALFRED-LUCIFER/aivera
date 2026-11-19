import { describe, expect, it } from 'vitest';
import {
  blankCompetency,
  excerptOf,
  parseRubric,
  rowErrors,
  rubricJson,
  starterCompetencies,
  toDraftCompetency,
  type DraftRow,
} from './draft.ts';

const description =
  'You will ship and run LLM assistants that real merchants use. You keep latency, cost per request and incidents in check.';

describe('excerptOf', () => {
  it('is the sentence holding the quote, with the quote offsets inside it', () => {
    const quote = 'latency, cost per request';
    const start = description.indexOf(quote);
    const excerpt = excerptOf(description, start, start + quote.length);
    expect(excerpt.text).toBe('You keep latency, cost per request and incidents in check.');
    expect(excerpt.text.slice(excerpt.start, excerpt.end)).toBe(quote);
  });

  it('is the list line in a bulleted description', () => {
    const list = 'Needs:\n- Python services in production\n- Eval sets';
    const start = list.indexOf('Python');
    const excerpt = excerptOf(list, start, start + 6);
    expect(excerpt.text).toBe('- Python services in production');
    expect(excerpt.text.slice(excerpt.start, excerpt.end)).toBe('Python');
  });

  it('spans every sentence a quote crosses', () => {
    const start = description.indexOf('merchants');
    const end = description.indexOf('latency') + 'latency'.length;
    expect(excerptOf(description, start, end).text).toBe(description);
  });
});

describe('toDraftCompetency', () => {
  it('keeps the rubric fields and turns each citation into an excerpt', () => {
    const start = description.indexOf('ship and run');
    const drafted = toDraftCompetency(description, {
      name: 'LLM systems in production',
      evidenceExpected: 'A shipped assistant',
      weightPercent: 25,
      levelNeeded: 4,
      type: 'mandatory',
      origin: 'from_description',
      citations: [{ sourceId: 'description', quote: 'ship and run', start, end: start + 12 }],
    });
    expect(drafted).toEqual({
      name: 'LLM systems in production',
      evidenceExpected: 'A shipped assistant',
      weightPercent: 25,
      levelNeeded: 4,
      type: 'mandatory',
      origin: 'from_description',
      why: null,
      excerpts: [{ text: 'You will ship and run LLM assistants that real merchants use.', start: 9, end: 21 }],
    });
  });

  it('keeps a suggestion its origin and its why (AIV-P1-009)', () => {
    const start = description.indexOf('real merchants');
    const suggested = toDraftCompetency(description, {
      name: 'Product judgement',
      evidenceExpected: 'Product decisions',
      weightPercent: 15,
      levelNeeded: 3,
      type: 'desirable',
      origin: 'suggested_by_aivera',
      why: 'Merchants use it, but the description asks for no product judgement.',
      citations: [{ sourceId: 'description', quote: 'real merchants', start, end: start + 14 }],
    });
    expect(suggested).toMatchObject({
      origin: 'suggested_by_aivera',
      why: 'Merchants use it, but the description asks for no product judgement.',
    });
  });
});
const row = (id: string, change: Partial<DraftRow> = {}): DraftRow => ({
  ...blankCompetency(),
  name: 'Cost and reliability',
  id,
  removed: false,
  ...change,
});

describe('Saving the rubric (AIV-P1-010)', () => {
  // SAFETY: mutation check: rowErrors skipped the name check -> this test failed (a nameless row could be saved)
  it('names each kept row to fix: no name, or a weight that is not a whole percent from 1 to 100', () => {
    const rows = [
      row('a'),
      row('b', { name: '  ' }),
      row('c', { weightPercent: 0 }),
      row('d', { weightPercent: 12.5, name: '' }),
      row('e', { name: '', removed: true }),
    ];
    expect(rowErrors(rows)).toEqual({ b: { name: true }, c: { weight: true }, d: { name: true, weight: true } });
  });

  it('posts the kept rows only, with their origin, and the server reads back the same competencies', () => {
    const rows = [row('a', { origin: 'suggested_by_aivera', why: 'Why.' }), row('b', { removed: true })];
    expect(parseRubric(rubricJson(rows))).toEqual([
      {
        name: 'Cost and reliability',
        evidenceExpected: '',
        weightPercent: 10,
        levelNeeded: 3,
        type: 'mandatory',
        origin: 'suggested_by_aivera',
      },
    ]);
    expect(parseRubric(rubricJson([row('b', { removed: true })]))).toBeNull();
  });
});

describe('starterCompetencies', () => {
  it("is the job type's four starters, weights totalling 100, and nothing before a job type is chosen", () => {
    const starters = starterCompetencies('ai_llm_engineering');
    expect(starters.map((c) => c.name)).toEqual([
      'LLM systems in production',
      'Retrieval and evaluation',
      'Python service engineering',
      'Cost and reliability',
    ]);
    expect(starters.reduce((sum, c) => sum + c.weightPercent, 0)).toBe(100);
    expect(starterCompetencies('')).toEqual([]);
  });
});
