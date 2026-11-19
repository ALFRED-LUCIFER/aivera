import { describe, expect, it } from 'vitest';
import { WorkspaceError, type Workspace, type WorkspaceStatus } from '../domain/workspace.ts';
import { statusUseCases } from './status.ts';
import type { WorkspaceStore } from './workspaces.ts';

// AIV-P2-037: an operator's status change, against a faked store that logs each write in order. Synthetic ids.
const W1 = '0190d4a2-0000-7000-8000-0000000000w1';
const PIA = '0190d4a2-0000-7000-8000-00000000a001';

function setup(status: WorkspaceStatus | null) {
  const writes: string[] = [];
  const store = {
    lockWorkspaceStatus: async () => status && ({ id: W1, status } as Workspace),
    updateStatus: async (_w: string, to: WorkspaceStatus) => void writes.push(`status ${to}`),
    operatorAudit: async (_w: string, operatorId: string, entry: { action: string; note?: string }) =>
      void writes.push(`audit ${entry.action} by ${operatorId}: ${entry.note}`),
  } as unknown as WorkspaceStore;
  const useCases = statusUseCases<'tx'>({ inWorkspace: (_id, work) => work(store, 'tx') });
  return { writes, useCases };
}

describe('changeStatus', () => {
  it('Scenario: A suspension is applied and audited: status, the other module, then the audit, last', async () => {
    const { writes, useCases } = setup('active');
    await useCases.changeStatus(
      { operatorId: PIA, workspaceId: W1, change: 'suspend', reason: '  Pilot ended on 30 Nov 2026 ' },
      async (tx) => void writes.push(`alongside ${tx}`),
    );
    expect(writes).toEqual([
      'status suspended',
      'alongside tx',
      `audit workspace.suspended by ${PIA}: Pilot ended on 30 Nov 2026`,
    ]);
  });

  it('Scenario: Reactivating records workspace.reactivated', async () => {
    const { writes, useCases } = setup('suspended');
    await useCases.changeStatus({
      operatorId: PIA,
      workspaceId: W1,
      change: 'reactivate',
      reason: 'Pilot extended to 31 Dec 2026',
    });
    expect(writes).toEqual(['status active', `audit workspace.reactivated by ${PIA}: Pilot extended to 31 Dec 2026`]);
  });

  it('Scenario: The operator approves: no reason needed, and the audit entry carries no note', async () => {
    const { writes, useCases } = setup('pending_approval');
    await useCases.changeStatus({ operatorId: PIA, workspaceId: W1, change: 'approve', reason: '' });
    expect(writes).toEqual(['status active', `audit workspace.approved by ${PIA}: undefined`]);
  });

  it('Scenario: The operator rejects with a reason', async () => {
    const { writes, useCases } = setup('pending_approval');
    await useCases.changeStatus({
      operatorId: PIA,
      workspaceId: W1,
      change: 'reject',
      reason: "Outside the pilot's agreed teams",
    });
    expect(writes).toEqual(['status rejected', `audit workspace.rejected by ${PIA}: Outside the pilot's agreed teams`]);
  });

  it.each([
    ['a rejection without a reason', 'pending_approval', 'reject', '   ', 'reason_required'],
    ['approving a workspace that is not waiting', 'active', 'approve', '', 'status_conflict'],
    ['a reason under 10 characters', 'active', 'suspend', 'too short', 'reason_required'],
    ['no such workspace', null, 'suspend', 'Pilot ended on 30 Nov 2026', 'not_found'],
    ['a workspace already suspended', 'suspended', 'suspend', 'Pilot ended on 30 Nov 2026', 'status_conflict'],
    ['reactivating an active workspace', 'active', 'reactivate', 'Pilot extended to 31 Dec', 'status_conflict'],
  ] as const)('refuses %s and writes nothing', async (_label, status, change, reason, code) => {
    const { writes, useCases } = setup(status);
    await expect(useCases.changeStatus({ operatorId: PIA, workspaceId: W1, change, reason })).rejects.toEqual(
      new WorkspaceError(code),
    );
    expect(writes).toEqual([]);
  });
});
