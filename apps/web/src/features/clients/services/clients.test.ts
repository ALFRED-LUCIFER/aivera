import { ForbiddenError, WorkspaceError, type Role } from '@aivera/workspaces';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { addClient, archiveClient, renameClient } from './clients.ts';

// AIV-P1-056: the client actions. The workspaces module is replaced; its role check is modelled on client.manage.
const DUNE = '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5d';
let role: Role = 'recruiter';
const ctx = () => ({ userId: 'u1', workspaceId: 'w1', role, tx: {} });
const manage = async (c: { role: Role }) => {
  if (c.role !== 'admin' && c.role !== 'recruiter') throw new ForbiddenError();
};
const workspaces = {
  addClient: vi.fn(async (c: { role: Role }, _name: string) => manage(c)),
  renameClient: vi.fn(async (c: { role: Role }, _id: string, _name: string) => manage(c)),
  archiveClient: vi.fn(async (c: { role: Role }, _id: string) => manage(c)),
};

// As in server/workspace.ts: a refused role renders the 403 page.
vi.mock('@/server/workspace', () => ({
  getWorkspaces: () => workspaces,
  inActiveWorkspace: async (fn: (c: ReturnType<typeof ctx>) => Promise<unknown>) => {
    try {
      return { value: await fn(ctx()) };
    } catch (error) {
      if (error instanceof ForbiddenError) throw new Error('NEXT_HTTP_ERROR_FALLBACK;403', { cause: error });
      throw error;
    }
  },
}));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));
vi.mock('next/navigation', () => ({
  forbidden: () => {
    throw new Error('NEXT_HTTP_ERROR_FALLBACK;403');
  },
  unstable_rethrow: (error: unknown) => {
    if (error instanceof Error && error.message.startsWith('NEXT_')) throw error;
  },
}));

beforeEach(() => {
  role = 'recruiter';
  vi.clearAllMocks();
});

describe('client actions', () => {
  it('a recruiter adds a client by its trimmed name', async () => {
    expect(await addClient('  Falcon Pay ')).toEqual({ ok: true });
    expect(workspaces.addClient).toHaveBeenCalledWith(expect.anything(), 'Falcon Pay');
  });

  // SAFETY: mutation check: caught every error in change() without unstable_rethrow -> this test failed (resolved 'failed')
  it.each(['hiring_owner', 'interviewer'] as const)('a %s calling addClient directly gets 403', async (r) => {
    role = r;
    await expect(addClient('Falcon Pay')).rejects.toThrow('NEXT_HTTP_ERROR_FALLBACK;403');
  });

  it('maps the module’s name rules to the field message, anything else to "failed"', async () => {
    workspaces.addClient.mockRejectedValueOnce(new WorkspaceError('client_exists'));
    expect(await addClient('Falcon Pay')).toEqual({ ok: false, error: 'exists' });
    workspaces.renameClient.mockRejectedValueOnce(new WorkspaceError('client_name'));
    expect(await renameClient(DUNE, 'x')).toEqual({ ok: false, error: 'name' });
    workspaces.archiveClient.mockRejectedValueOnce(new Error('db down'));
    expect(await archiveClient(DUNE)).toEqual({ ok: false, error: 'failed' });
  });

  it('refuses an empty name or a malformed id before calling the module', async () => {
    expect(await addClient('   ')).toEqual({ ok: false, error: 'name' });
    expect(await archiveClient('not-a-uuid')).toEqual({ ok: false, error: 'failed' });
    expect(workspaces.addClient).not.toHaveBeenCalled();
    expect(workspaces.archiveClient).not.toHaveBeenCalled();
  });
});
