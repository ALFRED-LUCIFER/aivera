import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setAiBudget } from './setAiBudget.ts';

// AIV-P2-038: the budget's server action, called directly. Synthetic opaque ids.
const PIA = '0190d4a2-0000-7000-8000-00000000a001';
const DEMO = '0190d4a2-0000-7000-8000-000000000001';
const operator = vi.fn<() => Promise<{ userId: string }>>();
const setWorkspaceAiBudget = vi.fn(async (_input: unknown) => undefined);

vi.mock('@/server/operator', () => ({
  platformOperator: () => operator(),
  setWorkspaceAiBudget: (input: unknown) => setWorkspaceAiBudget(input),
}));

beforeEach(() => {
  vi.clearAllMocks();
  operator.mockResolvedValue({ userId: PIA });
});

const change = { workspaceId: DEMO, dailyBudget: 500_000, reason: ' Pilot cap agreed with the team ' };

describe('setAiBudget (server action)', () => {
  it('Scenario: Setting an override: sets 500,000 with the trimmed reason', async () => {
    await setAiBudget(change);
    expect(setWorkspaceAiBudget).toHaveBeenCalledExactlyOnceWith({
      workspaceId: DEMO,
      dailyBudget: 500_000,
      reason: 'Pilot cap agreed with the team',
    });
  });

  it('a reset sends null', async () => {
    await setAiBudget({ ...change, dailyBudget: null });
    expect(setWorkspaceAiBudget).toHaveBeenCalledWith(expect.objectContaining({ dailyBudget: null }));
  });

  // SAFETY: mutation check: called setWorkspaceAiBudget(input) without aiBudgetChangeSchema.parse -> this test failed (budget set)
  it.each([99_999, 10_000_001, 1.5])('Scenario Outline: Bounds: %d is refused and nothing changes', async (value) => {
    await expect(setAiBudget({ ...change, dailyBudget: value })).rejects.toThrow();
    expect(setWorkspaceAiBudget).not.toHaveBeenCalled();
  });

  it('a missing reason or a workspace id that is not a uuid is refused', async () => {
    await expect(setAiBudget({ ...change, reason: ' ' })).rejects.toThrow();
    await expect(setAiBudget({ ...change, workspaceId: 'demo' })).rejects.toThrow();
    expect(setWorkspaceAiBudget).not.toHaveBeenCalled();
  });

  // SAFETY: mutation check: removed `await platformOperator()` from setAiBudget -> this test failed (budget set)
  it('Scenario: Non-operators are refused: a direct call is a 403 and the budget is unchanged', async () => {
    operator.mockRejectedValue(new Error('NEXT_HTTP_ERROR_FALLBACK;403'));
    await expect(setAiBudget(change)).rejects.toThrow('NEXT_HTTP_ERROR_FALLBACK;403');
    expect(setWorkspaceAiBudget).not.toHaveBeenCalled();
  });
});
