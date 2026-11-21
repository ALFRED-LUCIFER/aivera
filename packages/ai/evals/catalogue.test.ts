import { describe, expect, it } from 'vitest';
import { AiUnavailable, type AiClient } from '../src/client.ts';
import { evaluateCatalogue, recordedClient, runBudget, uncoveredPacks } from './catalogue.ts';
import { domainCatalogue, liveTokenCap } from './config.ts';
import { loadGolden } from './golden.ts';

// Feature: Run the eval set on a catalogue draft (AIV-P2-048). Recorded answers only: no model call in CI.

const golden = loadGolden(import.meta.dirname);
const v1 = { domains: [...domainCatalogue.domains], regions: [...domainCatalogue.regions] };
const noModel: Pick<AiClient, 'generateStructured'> = {
  generateStructured: () => Promise.reject(new Error('no model call expected')),
};

describe('the coverage rule', () => {
  it('every pack key of version 1 has golden cases', () => {
    expect(uncoveredPacks(v1.domains, golden.get('jobs.detectDomain') ?? [])).toEqual([]);
  });

  // SAFETY: mutation check: skipped the uncovered check in evaluateCatalogue -> this test failed (the model was called)
  it('Scenario: A new pack without golden cases cannot pass, and no model is called', async () => {
    const result = await evaluateCatalogue(noModel, { ...v1, domains: [...v1.domains, 'insurance'] });
    expect(result).toEqual({ outcome: 'failed', uncovered: ['insurance'], tasks: [] });
  });
});

describe('a run with recorded answers', () => {
  it('Scenario: A passing run reports each task with its group rates', async () => {
    const result = await evaluateCatalogue(recordedClient(), v1);
    expect(result.outcome).toBe('passed');
    expect(result.tasks.map((t) => t.task)).toEqual(['jobs.detectDomain', 'jobs.draftCompetencies']);
    const detect = result.tasks[0];
    expect(detect?.groups.map((g) => g.group)).toEqual(['domain', 'none', 'fairness']);
    expect(detect?.groups.every((g) => g.total > 0)).toBe(true);
    expect(result.tasks[1]?.fieldMatch).toBeGreaterThanOrEqual(0.9);
  });

  it('Scenario: A failing run lists the failed case ids', async () => {
    // A draft whose change leaves jobs.draftCompetencies drafting nothing: field match falls below 0.9.
    const empty = { competencies: [], refused: false, reason: null, suggestions: [] };
    const worse = recordedClient(import.meta.dirname, (c, task) =>
      task === 'jobs.draftCompetencies' ? empty : c.recorded.output,
    );
    const result = await evaluateCatalogue(worse, v1);
    expect(result.outcome).toBe('failed');
    expect(result.tasks[1]).toMatchObject({ task: 'jobs.draftCompetencies', passed: false });
    expect(result.tasks[1]?.failedCases).toContain('software-engineer');
  });

  it('Scenario: The AI deployment is unavailable', async () => {
    const down = { generateStructured: () => Promise.reject(new AiUnavailable('jobs.detectDomain', 'timeout')) };
    expect((await evaluateCatalogue(down as Pick<AiClient, 'generateStructured'>, v1)).outcome).toBe('unavailable');
  });
});

describe('the run budget', () => {
  it('is the run cap or what the day has left, whichever is lower, and counts what the run spent', async () => {
    expect((await runBudget(10_000_000).spentToday('w', 'd')).limit).toBe(liveTokenCap);
    const budget = runBudget(1_000);
    await budget.add('w', 'd', 400);
    expect(await budget.spentToday('w', 'd')).toEqual({ spent: 400, limit: 1_000 });
    expect(budget.used()).toBe(400);
    expect((await runBudget(-5).spentToday('w', 'd')).limit).toBe(0);
  });
});
