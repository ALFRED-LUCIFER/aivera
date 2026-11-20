import { describe, expect, it, vi } from 'vitest';
import type { WorkspaceContext } from './context.ts';
import { hashToken, invitationsUseCases } from './invitations.ts';
import type { WorkspaceStore } from './workspaces.ts';

const W1 = '0190d4a2-0000-7000-8000-000000000001';

describe('inviteMember', () => {
  it('stores only the hash of the token it returns for the link', async () => {
    const insertInvitation = vi.fn(async (_workspaceId: string, values: Record<string, unknown>) => values);
    const store = {
      insertInvitation,
      readSettings: async () => null,
      audit: async () => {},
    } as unknown as WorkspaceStore;
    const useCases = invitationsUseCases<null>({
      storeFor: () => store,
      inWorkspace: (_id, work) => work(store),
      newId: () => 'invitation-1',
      now: () => new Date('2026-11-20T09:00:00Z'),
      authorize: async () => {},
      grantJobAccess: async () => {},
      revokeJobAccess: async () => {},
    });
    const ctx: WorkspaceContext<null> = { userId: 'u1', workspaceId: W1, role: 'admin', status: 'active', tx: null };

    const { token } = await useCases.inviteMember(ctx, {
      email: ' Lina@Example.com ',
      role: 'interviewer',
      title: null,
      jobIds: ['job-1'],
      clientIds: [],
    });

    expect(token.startsWith(`${W1}.`)).toBe(true);
    expect(token.length).toBeGreaterThan(W1.length + 40);
    const stored = insertInvitation.mock.calls[0]?.[1];
    expect(stored).toMatchObject({ tokenHash: hashToken(token), email: 'lina@example.com' });
    expect(JSON.stringify(stored)).not.toContain(token.split('.')[1]);
  });
});
