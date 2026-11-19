import { describe, expect, it } from 'vitest';
import { aiBudgetError, parseTokens } from './aiBudget.ts';

// AIV-P2-038: the budget change's schema and the form's number parsing. Synthetic opaque ids.
const change = { workspaceId: '0190d4a2-0000-7000-8000-000000000001', reason: 'Pilot cap agreed with the team' };

describe('Scenario Outline: Bounds', () => {
  // SAFETY: mutation check: removed .min(AI_DAILY_TOKEN_BUDGET.min) from aiBudgetChangeSchema -> this test failed (99,999 accepted)
  it.each(['99,999', '10,000,001', '0', '-500000', '1.5', '500 000', '5,00,000', 'many', ''])('refuses %j', (text) => {
    expect(aiBudgetError({ ...change, dailyBudget: parseTokens(text) })).toBe('bounds');
  });

  it.each([
    ['100,000', 100_000],
    ['500000', 500_000],
    [' 10,000,000 ', 10_000_000],
  ])('accepts %j as %i', (text, value) => {
    expect(parseTokens(text)).toBe(value);
    expect(aiBudgetError({ ...change, dailyBudget: value })).toBeNull();
  });

  it('accepts a reset to the platform default (null)', () => {
    expect(aiBudgetError({ ...change, dailyBudget: null })).toBeNull();
  });
});

describe('the reason', () => {
  it.each([
    ['empty', ''],
    ['blank', '   '],
    ['over 500 characters', 'x'.repeat(501)],
  ])('refuses a reason that is %s', (_, reason) => {
    expect(aiBudgetError({ ...change, reason, dailyBudget: 500_000 })).toBe('reason');
  });
});
