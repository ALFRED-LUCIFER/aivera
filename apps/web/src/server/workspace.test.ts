import { ForbiddenError, type WorkspaceContext } from '@aivera/workspaces';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { workspaceAction } from './workspace.ts';

const W1 = '0190d4a2-0000-7000-8000-000000000001';
const session = vi.fn<() => Promise<string | null>>();
const fake = {
  activeWorkspace: vi.fn<() => Promise<string | null>>(),
  withWorkspace: vi.fn(),
  authorize: vi.fn(),
};

const telemetry = vi.hoisted(() => ({
  annotateSpan: vi.fn(),
  withSpan: vi.fn((_name: string, fn: () => Promise<unknown>) => fn()),
}));
vi.mock('@aivera/observability', () => telemetry);
vi.mock('./auth', () => ({ getSessionUserId: () => session(), getIdentity: () => ({}) }));
vi.mock('./db', () => ({ getDb: () => ({}) }));
vi.mock('@aivera/audit/composition', () => ({ createAudit: () => ({}) }));
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
const handler = vi.fn(async (_ctx: WorkspaceContext, input: { candidateId: string }) => `ok ${input.candidateId}`);
// Stands in for a lookup of the stored record's job through ctx.tx: candidate C2 is on job J2.
const jobOf = vi.fn(async (_ctx: WorkspaceContext, { candidateId }: { candidateId: string }) => ({
  jobId: candidateId === 'C2' ? 'J2' : 'J1',
}));
const viewCandidate = workspaceAction('candidate.view', handler, {
  input: z.object({ candidateId: z.string() }),
  resource: jobOf,
});

beforeEach(() => {
  vi.clearAllMocks();
  session.mockResolvedValue('u1');
  fake.activeWorkspace.mockResolvedValue(W1);
  fake.withWorkspace.mockImplementation((_s, _w, fn: (c: WorkspaceContext) => unknown) => fn(ctx));
  fake.authorize.mockResolvedValue(undefined);
});

describe('workspaceAction', () => {
  it("runs the handler in the active workspace after authorising the action on the record's job", async () => {
    expect(await viewCandidate({ candidateId: 'C2' })).toBe('ok C2');
    expect(fake.withWorkspace).toHaveBeenCalledWith({ userId: 'u1' }, W1, expect.any(Function));
    expect(jobOf).toHaveBeenCalledWith(ctx, { candidateId: 'C2' });
    expect(fake.authorize).toHaveBeenCalledWith(ctx, 'candidate.view', { jobId: 'J2' });
  });

  // Correlation (AIV-P0-018): the span carries the workspace id, never the user's email.
  it('runs in a span named after the action, tagged with the workspace id', async () => {
    await viewCandidate({ candidateId: 'C1' });
    expect(telemetry.withSpan).toHaveBeenCalledWith('action candidate.view', expect.any(Function));
    expect(telemetry.annotateSpan).toHaveBeenCalledWith({ 'workspace.id': W1 });
  });

  it('rejects input that fails its schema before opening any workspace', async () => {
    await expect(viewCandidate({ candidateId: 7 } as unknown as { candidateId: string })).rejects.toThrow();
    expect(fake.activeWorkspace).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
  });

  // SAFETY: mutation check: dropped the authorize call from workspaceAction -> this test failed
  it('a refused action renders the 403 page and never runs the handler', async () => {
    fake.authorize.mockRejectedValue(new ForbiddenError());
    await expect(viewCandidate({ candidateId: 'C2' })).rejects.toThrow('403');
    expect(handler).not.toHaveBeenCalled();
  });

  it('a user who is not a member of the active workspace gets the 403 page', async () => {
    fake.withWorkspace.mockRejectedValue(new ForbiddenError());
    await expect(viewCandidate({ candidateId: 'C1' })).rejects.toThrow('403');
  });

  it('no active workspace is 403, and no session goes to sign-in', async () => {
    fake.activeWorkspace.mockResolvedValue(null);
    await expect(viewCandidate({ candidateId: 'C1' })).rejects.toThrow('403');
    session.mockResolvedValue(null);
    await expect(viewCandidate({ candidateId: 'C1' })).rejects.toThrow('NEXT_REDIRECT;/sign-in');
    expect(handler).not.toHaveBeenCalled();
  });
});
