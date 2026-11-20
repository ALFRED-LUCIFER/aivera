import { describe, expect, it, vi } from 'vitest';
import type { Member, Role } from '../domain/workspace.ts';
import { workspacesUseCases, type WorkspaceStore } from './workspaces.ts';

const W = '0190d4a2-0000-7000-8000-000000000001';
const members: Member[] = [
  { userId: 'alex', workspaceId: W, role: 'admin', status: 'active', title: null },
  { userId: 'lina', workspaceId: W, role: 'interviewer', status: 'active', title: null },
];

describe('changeRole and job grants', () => {
  // SAFETY: mutation check: removed the deleteGrantsOf call from changeRole -> the admin and recruiter rows failed
  it.each<[Role, boolean]>([
    ['admin', true],
    ['recruiter', true],
    ['hiring_owner', false],
    ['interviewer', false],
  ])('changing a member to %s deletes their grants: %s', async (role, deleted) => {
    const store = {
      lockMembers: async () => members,
      updateRole: vi.fn(async () => {}),
      deleteGrantsOf: vi.fn(async () => []),
      audit: vi.fn(async () => {}),
    };
    const { changeRole } = workspacesUseCases({
      inWorkspace: (_id, work) => work(store as unknown as WorkspaceStore),
      newId: () => 'id',
    });
    await changeRole({ workspaceId: W, actorUserId: 'alex', targetUserId: 'lina', role });
    if (deleted) expect(store.deleteGrantsOf).toHaveBeenCalledWith(W, 'lina');
    else expect(store.deleteGrantsOf).not.toHaveBeenCalled();
  });
});
