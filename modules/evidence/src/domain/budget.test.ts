import { expect, it } from 'vitest';
import { budgetResetAt } from './budget.ts';

// AIV-P1-089: the day boundary is UTC, so the reset time is the same wherever the worker runs.
it.each([
  ['2026-11-20T09:00:00.000Z', '2026-11-21T00:05:00.000Z'],
  ['2026-11-20T23:59:59.999Z', '2026-11-21T00:05:00.000Z'],
  ['2026-11-21T00:00:00.000Z', '2026-11-22T00:05:00.000Z'],
  ['2026-12-31T12:00:00.000Z', '2027-01-01T00:05:00.000Z'],
])('%s -> %s', (now, reset) => {
  expect(budgetResetAt(new Date(now)).toISOString()).toBe(reset);
});
