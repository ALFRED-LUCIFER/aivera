import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { parse } from 'yaml';
import { pairKey } from '../domain/corroboration.ts';
import { comparePairs } from './mapping.ts';

// AIV-P1-078: which pairs reach the AI comparison. Synthetic cast only (docs/00-product/personas.md).

const LLM = 'llm-systems';
const link = (sourceId: string, excerpt: string, competencyId = LLM) => ({
  competencyId,
  sourceId,
  provenance: 'submitted' as const,
  excerpt,
});
const compareWith = (answer: number[] | null) => vi.fn<Parameters<typeof comparePairs>[4]>(async () => answer);
const run = (
  links: ReturnType<typeof link>[],
  compare: ReturnType<typeof compareWith>,
  flagged: ReadonlySet<string> = new Set(),
) => comparePairs(links, [], flagged, (sourceId) => (sourceId === 'reference' ? 'reference' : 'document'), compare);

describe('comparePairs', () => {
  // SAFETY: mutation check: sent every compared pair (settled ones too) to the model -> this test failed
  it('Scenario: Settled pairs never reach the model', async () => {
    const compare = compareWith([]);
    const contradiction = await run(
      [link('write-up', 'led a team of 12 engineers'), link('reference', 'managed 5 engineers')],
      compare,
    );
    const agreement = await run(
      [link('write-up', 'led a team of 12 engineers'), link('reference', 'He ran a 12-person team.')],
      compare,
    );
    expect(compare).not.toHaveBeenCalled();
    expect(contradiction.pairs).toEqual([{ a: 0, b: 1, outcome: 'contradiction', method: 'numeric_precheck' }]);
    expect(agreement.pairs).toEqual([{ a: 0, b: 1, outcome: 'agreement', method: 'numeric_precheck' }]);
    expect(contradiction.compared).toEqual({ sent: 0, flagged: 0, rejected: 0 });
  });

  it('Scenario: Worded numbers are judged by the model, once for the pair', async () => {
    const compare = compareWith([0]);
    const result = await run(
      [link('write-up', 'about 9,000 merchants use the assistant'), link('reference', 'a few hundred merchants')],
      compare,
    );
    expect(compare).toHaveBeenCalledOnce();
    expect(compare).toHaveBeenCalledWith(
      [
        { id: '0', kind: 'document', text: 'about 9,000 merchants use the assistant' },
        { id: '1', kind: 'reference', text: 'a few hundred merchants' },
      ],
      [['0', '1']],
    );
    expect(result.pairs).toEqual([{ a: 0, b: 1, outcome: 'contradiction', method: 'ai' }]);
    expect(result.compared).toEqual({ sent: 1, flagged: 1, rejected: 0 });
  });

  it('batches every unsettled pair of the run into one call, sending each pair once and keeping only the flags', async () => {
    const compare = compareWith([1]);
    const result = await run(
      [
        link('write-up', 'about 9,000 merchants use the assistant'),
        link('reference', 'thousands of merchants rely on it'),
        link('blog', 'a few hundred merchants'),
        link('write-up', 'led a team of 12 engineers', 'leadership'),
        link('reference', 'managed 5 engineers', 'leadership'),
      ],
      compare,
    );
    expect(compare).toHaveBeenCalledOnce();
    expect(compare.mock.calls[0]?.[1]).toEqual([
      ['0', '1'],
      ['0', '2'],
    ]);
    expect(result.pairs).toEqual([
      { a: 3, b: 4, outcome: 'contradiction', method: 'numeric_precheck' },
      { a: 0, b: 2, outcome: 'contradiction', method: 'ai' },
    ]);
  });

  // SAFETY: mutation check: kept the pairs of a rejected answer as contradictions -> this test failed
  it('Scenario: An answer the citation contract rejects stores no contradiction, and is counted', async () => {
    const result = await run(
      [link('write-up', 'about 9,000 merchants use the assistant'), link('reference', 'a few hundred merchants')],
      compareWith(null),
    );
    expect(result.pairs).toEqual([]);
    expect(result.compared).toEqual({ sent: 1, flagged: 0, rejected: 1 });
  });

  // SAFETY: mutation check: sent earlier-flagged pairs to the model again instead of keeping them -> this test failed
  it('a pair flagged in an earlier run stays a contradiction without a call, so only a person ends it', async () => {
    const writeUp = link('write-up', 'about 9,000 merchants use the assistant');
    const reference = link('reference', 'a few hundred merchants');
    const compare = compareWith(null);
    const result = await run([writeUp, reference], compare, new Set([pairKey(reference, writeUp)]));
    expect(compare).not.toHaveBeenCalled();
    expect(result.pairs).toEqual([{ a: 0, b: 1, outcome: 'contradiction', method: 'ai' }]);
    expect(result.compared).toEqual({ sent: 0, flagged: 0, rejected: 0 });
  });

  it('every pair in the eval golden set is one the pre-check leaves to the model', async () => {
    const dir = join(
      import.meta.dirname,
      '..',
      '..',
      '..',
      '..',
      'packages',
      'ai',
      'evals',
      'evidence.compareExcerpts',
    );
    const cases = readdirSync(dir).map(
      (file) => parse(readFileSync(join(dir, file), 'utf8')) as { id: string; sources: { text: string }[] },
    );
    expect(cases).toHaveLength(17);
    for (const c of cases) {
      const compare = compareWith([]);
      await run([link('write-up', c.sources[0]?.text ?? ''), link('reference', c.sources[1]?.text ?? '')], compare);
      expect(compare, c.id).toHaveBeenCalledOnce();
    }
  });
});
