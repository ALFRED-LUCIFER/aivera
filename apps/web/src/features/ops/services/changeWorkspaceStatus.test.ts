import { beforeEach, describe, expect, it, vi } from 'vitest';
import { changeWorkspaceStatus } from './changeWorkspaceStatus.ts';

// AIV-P2-037: the status change server action, called directly. Synthetic opaque ids.
const PIA = '0190d4a2-0000-7000-8000-00000000a001';
const GULF = '0190d4a2-0000-7000-8000-0000000000b2';
const operator = vi.fn<() => Promise<{ userId: string }>>();
const applyStatusChange = vi.fn(async (..._args: unknown[]) => {});

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/server/operator', () => ({
  platformOperator: () => operator(),
  applyStatusChange: (...args: unknown[]) => applyStatusChange(...args),
}));

beforeEach(() => {
  vi.clearAllMocks();
  operator.mockResolvedValue({ userId: PIA });
});

describe('changeWorkspaceStatus (server action)', () => {
  it('Scenario: A suspension is applied and audited: passes the trimmed reason on', async () => {
    await changeWorkspaceStatus({ workspaceId: GULF, change: 'suspend', reason: ' Pilot ended on 30 Nov 2026 ' });
    expect(applyStatusChange).toHaveBeenCalledWith(GULF, 'suspend', 'Pilot ended on 30 Nov 2026');
  });

  it('Scenario: Suspending needs a reason: under 10 characters is refused on the server, nothing changes', async () => {
    await expect(
      changeWorkspaceStatus({ workspaceId: GULF, change: 'suspend', reason: ' too short ' }),
    ).rejects.toThrow();
    expect(applyStatusChange).not.toHaveBeenCalled();
  });

  it('Scenario: The operator approves: approving needs no reason', async () => {
    await changeWorkspaceStatus({ workspaceId: GULF, change: 'approve', reason: '' });
    expect(applyStatusChange).toHaveBeenCalledWith(GULF, 'approve', '');
  });

  it('Scenario: The operator rejects with a reason: under 10 characters is refused, nothing changes', async () => {
    await expect(changeWorkspaceStatus({ workspaceId: GULF, change: 'reject', reason: 'No' })).rejects.toThrow();
    expect(applyStatusChange).not.toHaveBeenCalled();
    await changeWorkspaceStatus({ workspaceId: GULF, change: 'reject', reason: "Outside the pilot's agreed teams" });
    expect(applyStatusChange).toHaveBeenCalledWith(GULF, 'reject', "Outside the pilot's agreed teams");
  });

  // SAFETY: mutation check: removed `await platformOperator()` from changeWorkspaceStatus -> this test failed
  it('Scenario: Non-operators cannot suspend (AIV-P2-037) or decide (AIV-P2-039): a direct call is a 403, status unchanged', async () => {
    operator.mockRejectedValue(new Error('NEXT_HTTP_ERROR_FALLBACK;403'));
    await expect(
      changeWorkspaceStatus({ workspaceId: GULF, change: 'suspend', reason: 'Pilot ended on 30 Nov 2026' }),
    ).rejects.toThrow('NEXT_HTTP_ERROR_FALLBACK;403');
    expect(applyStatusChange).not.toHaveBeenCalled();
  });
});
