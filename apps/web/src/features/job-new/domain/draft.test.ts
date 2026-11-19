import { describe, expect, it } from 'vitest';
import { excerptOf, starterCompetencies, toDraftCompetency } from './draft.ts';

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
      excerpts: [{ text: 'You will ship and run LLM assistants that real merchants use.', start: 9, end: 21 }],
    });
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
