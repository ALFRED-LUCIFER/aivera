import { ForbiddenError, type WorkspaceContext } from '@aivera/workspaces';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { workspaceAction } from './workspace.ts';

const W1 = '0190d4a2-0000-7000-8000-000000000001';
const session = vi.fn<() => Promise<string | null>>();
const fake = {
  activeWorkspace: vi.fn<() => Promise<string | null>>(),
  withWorkspace: vi.fn(),
  authorize: vi.fn(),
};

vi.mock('./auth', () => ({ getSessionUserId: () => session() }));
vi.mock('./db', () => ({ getDb: () => ({}) }));
vi.mock('@aivera/audit/composition', () => ({ createAudit: () => ({}) }));
vi.mock('@aivera/identity/composition', () => ({ createIdentity: () => ({}) }));
vi.mock('@aivera/workspaces/composition', () => ({ createWorkspaces: () => fake }));
vi.mock('next/navigation', () => ({
  forbidden: () => {
    throw new Error('NEXT_HTTP_ERROR_FALLBACK;403');
  },
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT;${to}`);
  },
}));

const ctx: WorkspaceContext = { userId: 'u1', workspaceId: W1, role: 'interviewer', tx: {} as WorkspaceContext['tx'] };
const handler = vi.fn(async (_ctx: WorkspaceContext, input: { jobId: string }) => `ok ${input.jobId}`);
const viewCandidate = workspaceAction('candidate.view', handler, { resource: ({ jobId }) => ({ jobId }) });

beforeEach(() => {
  vi.clearAllMocks();
  session.mockResolvedValue('u1');
  fake.activeWorkspace.mockResolvedValue(W1);
  fake.withWorkspace.mockImplementation((_s, _w, fn: (c: WorkspaceContext) => unknown) => fn(ctx));
  fake.authorize.mockResolvedValue(undefined);
});

describe('workspaceAction', () => {
  it('runs the handler in the active workspace after authorising the action on the named job', async () => {
    expect(await viewCandidate({ jobId: 'J1' })).toBe('ok J1');
    expect(fake.withWorkspace).toHaveBeenCalledWith({ userId: 'u1' }, W1, expect.any(Function));
    expect(fake.authorize).toHaveBeenCalledWith(ctx, 'candidate.view', { jobId: 'J1' });
  });

  // SAFETY: mutation check: dropped the authorize call from workspaceAction -> this test failed
  it('a refused action renders the 403 page and never runs the handler', async () => {
    fake.authorize.mockRejectedValue(new ForbiddenError());
    await expect(viewCandidate({ jobId: 'J2' })).rejects.toThrow('403');
    expect(handler).not.toHaveBeenCalled();
  });

  it('a user who is not a member of the active workspace gets the 403 page', async () => {
    fake.withWorkspace.mockRejectedValue(new ForbiddenError());
    await expect(viewCandidate({ jobId: 'J1' })).rejects.toThrow('403');
  });

  it('no active workspace is 403, and no session goes to sign-in', async () => {
    fake.activeWorkspace.mockResolvedValue(null);
    await expect(viewCandidate({ jobId: 'J1' })).rejects.toThrow('403');
    session.mockResolvedValue(null);
    await expect(viewCandidate({ jobId: 'J1' })).rejects.toThrow('NEXT_REDIRECT;/sign-in');
    expect(handler).not.toHaveBeenCalled();
  });
});
