import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initialCreateWorkspaceState } from '../domain/signup.ts';
import { createWorkspace } from './createWorkspace.ts';

const workspaces = { activeWorkspace: vi.fn(), createWorkspace: vi.fn() };
const session = vi.fn<() => Promise<string | null>>();

vi.mock('@/server/auth', () => ({
  getSessionUserId: () => session(),
  getIdentity: () => ({
    getUser: async () => ({ id: 'u1', email: 'nadia@example.com', displayName: 'Nadia Freelance' }),
  }),
}));
vi.mock('@/server/workspace', () => ({ getWorkspaces: () => workspaces }));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));
vi.mock('next/navigation', () => ({
  forbidden: () => {
    throw new Error('NEXT_HTTP_ERROR_FALLBACK;403');
  },
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT;${to}`);
  },
}));

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
};
const submit = (fields: Record<string, string>) => createWorkspace(initialCreateWorkspaceState, form(fields));

beforeEach(() => {
  vi.clearAllMocks();
  session.mockResolvedValue('u1');
  workspaces.activeWorkspace.mockResolvedValue(null);
  workspaces.createWorkspace.mockResolvedValue({ id: 'w1' });
});

describe('createWorkspace (server action)', () => {
  it('creates the workspace for the session user, named after them with no company, and lands on My desk', async () => {
    await expect(submit({ company: '', hiringFocus: 'sales' })).rejects.toThrow('NEXT_REDIRECT;/app');
    expect(workspaces.createWorkspace).toHaveBeenCalledWith({
      name: 'Nadia Freelance',
      company: '',
      hiringFocus: 'sales',
      creatorUserId: 'u1',
    });
  });

  it('sends no session to sign-in', async () => {
    session.mockResolvedValue(null);
    await expect(submit({ hiringFocus: 'sales' })).rejects.toThrow('NEXT_REDIRECT;/sign-in');
    expect(workspaces.createWorkspace).not.toHaveBeenCalled();
  });

  // SAFETY: mutation check: removed the activeWorkspace check -> this test failed (a second workspace was created)
  it('refuses a user who already has a workspace, so it cannot switch them out of it', async () => {
    workspaces.activeWorkspace.mockResolvedValue('w0');
    await expect(submit({ hiringFocus: 'sales' })).rejects.toThrow('NEXT_HTTP_ERROR_FALLBACK;403');
    expect(workspaces.createWorkspace).not.toHaveBeenCalled();
  });

  // SAFETY: mutation check: logged `error.message` instead of `error.name` -> this test failed (the log held the name)
  it('on a service error keeps what was typed and logs no personal data', async () => {
    const log = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    workspaces.createWorkspace.mockRejectedValue(new Error('duplicate key: Demo Hiring Co, Nadia Freelance'));
    await expect(submit({ company: 'Demo Hiring Co', hiringFocus: 'sales' })).resolves.toEqual({
      error: 'failed',
      values: { company: 'Demo Hiring Co', hiringFocus: 'sales' },
    });
    expect(log).toHaveBeenCalledOnce();
    expect(String(log.mock.calls[0])).not.toMatch(/Demo Hiring|Nadia/);
  });
});
