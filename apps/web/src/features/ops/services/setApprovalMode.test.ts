import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setApprovalMode } from './setApprovalMode.ts';

// AIV-P2-039: the approval switch's server action, called directly. Synthetic opaque ids.
const THEO = '0190d4a2-0000-7000-8000-00000000a002';
const operator = vi.fn<() => Promise<{ userId: string }>>();
const setApprovalRequired = vi.fn(async (..._args: unknown[]) => {});

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/server/operator', () => ({
  platformOperator: () => operator(),
  setApprovalRequired: (...args: unknown[]) => setApprovalRequired(...args),
}));

beforeEach(() => {
  vi.clearAllMocks();
  operator.mockResolvedValue({ userId: THEO });
});

describe('setApprovalMode (server action)', () => {
  it('Scenario: Changing the switch: turns it off with the trimmed reason', async () => {
    await setApprovalMode({ required: false, reason: ' Pilot open to all ' });
    expect(setApprovalRequired).toHaveBeenCalledWith(false, 'Pilot open to all');
  });

  it('refuses a reason under 10 characters and changes nothing', async () => {
    await expect(setApprovalMode({ required: false, reason: 'short' })).rejects.toThrow();
    expect(setApprovalRequired).not.toHaveBeenCalled();
  });

  // SAFETY: mutation check: removed `await platformOperator()` from setApprovalMode -> this test failed
  it('a non-operator gets 403 and the switch is unchanged', async () => {
    operator.mockRejectedValue(new Error('NEXT_HTTP_ERROR_FALLBACK;403'));
    await expect(setApprovalMode({ required: false, reason: 'Pilot open to all' })).rejects.toThrow('403');
    expect(setApprovalRequired).not.toHaveBeenCalled();
  });
});
