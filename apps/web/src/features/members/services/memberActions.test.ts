import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initialManageState } from '../domain/members.ts';
import { manageMember } from './memberActions.ts';

// AIV-P2-060: removing a member also takes them off the jobs they own, in the removal's transaction and before it, so
// no rubric email reaches them. The database side is tests/integration/src/workspaces.test.ts. Synthetic cast.

const HEAD = '0190d4a2-0000-7000-8000-0000000052bb'; // Head of Engineering, hiring owner of Senior AI Engineer
const calls: string[] = [];
const ctx = { userId: 'admin', workspaceId: 'w1', role: 'admin', status: 'active', tx: {} };
const jobs = {
  listJobs: vi.fn(async () => [
    { id: 'sae', hiringOwnerUserId: HEAD },
    { id: 'spd', hiringOwnerUserId: 'design-director' },
    { id: 'pm', hiringOwnerUserId: null },
  ]),
  changeHiringOwner: vi.fn(async (_ctx: unknown, jobId: string, owner: string | null) => {
    calls.push(`owner ${jobId} ${owner}`);
  }),
};
const workspaces = {
  authorize: vi.fn(async (_ctx: unknown, action: string) => {
    calls.push(`authorize ${action}`);
  }),
  removeMember: vi.fn(async (_ctx: unknown, userId: string) => {
    calls.push(`remove ${userId}`);
  }),
};

vi.mock('@/server/jobs', () => ({ getJobs: () => jobs }));
vi.mock('@/server/workspace', () => ({
  getWorkspaces: () => workspaces,
  inActiveWorkspace: async (fn: (c: typeof ctx) => Promise<unknown>) => ({ value: await fn(ctx) }),
}));
vi.mock('@/server/notifications', () => ({ getNotifications: () => null, senderFor: async () => null }));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));

const remove = (userId: string) => {
  const form = new FormData();
  form.set('intent', 'remove');
  form.set('userId', userId);
  return manageMember(initialManageState, form);
};

beforeEach(() => {
  vi.clearAllMocks();
  calls.length = 0;
});

describe('Scenario: A removed hiring owner is not emailed', () => {
  // SAFETY: mutation check: dropped the changeHiringOwner loop from removeMember -> this test failed
  it('only an admin goes on; the jobs he owns lose their hiring owner before he is removed, and no other job changes', async () => {
    expect(await remove(HEAD)).toEqual({ error: null, done: 1 });
    expect(calls).toEqual(['authorize member.invite', 'owner sae null', `remove ${HEAD}`]);
  });
});
