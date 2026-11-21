import { describe, expect, it } from 'vitest';
import { evalView } from './catalogueEval.ts';

// AIV-P2-048: what the page shows of the draft's eval. Synthetic golden case ids only.
const finishedAt = new Date('2026-11-21T09:00:00Z');
const result = {
  uncovered: [],
  tasks: [
    {
      task: 'jobs.detectDomain',
      passed: false,
      fieldMatch: 0.95,
      groups: [
        { group: 'domain', n: 17, total: 18 },
        { group: 'none', n: 6, total: 6 },
        { group: 'fairness', n: 4, total: 4 },
      ],
      failedCases: ['telecom-prepaid-gurugram'],
    },
    { task: 'jobs.draftCompetencies', passed: true, fieldMatch: 0.9234, groups: [], failedCases: [] },
  ],
};

describe('the eval view', () => {
  it('lists each task with its observed rates, and the failed case ids', () => {
    expect(evalView({ status: 'failed', finishedAt, tokens: 10, result })).toEqual({
      status: 'failed',
      finishedAt,
      uncovered: [],
      failedCases: ['telecom-prepaid-gurugram'],
      tasks: [
        {
          task: 'detectDomain',
          metrics: [
            { key: 'domain', percent: 94.4 },
            { key: 'none', percent: 100 },
            { key: 'fairness', percent: 100 },
          ],
        },
        { task: 'draftCompetencies', metrics: [{ key: 'fieldMatch', percent: 92.3 }] },
      ],
    });
  });

  it('a state without a result is its status alone; no draft is null', () => {
    expect(evalView({ status: 'stale', finishedAt })).toEqual({ status: 'stale' });
    expect(evalView({ status: 'running', requestedAt: finishedAt })).toEqual({ status: 'running' });
    expect(evalView(null)).toBeNull();
  });
});
