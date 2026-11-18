import { ForbiddenError, type Role } from '@aivera/workspaces';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initialNewJobState } from '../domain/jobNew.ts';
import { addJob } from './addJob.ts';

const owner = '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';
const interviewer = '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c';
const client = '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5d';
let role: Role = 'recruiter';
const ctx = () => ({ userId: 'u1', workspaceId: 'w1', role, tx: {} });

const workspaces = {
  authorize: vi.fn(async (c: { role: Role }) => {
    if (c.role !== 'admin' && c.role !== 'recruiter') throw new ForbiddenError();
  }),
  getWorkspace: vi.fn(),
  listMembers: vi.fn(async () => [
    { userId: owner, workspaceId: 'w1', role: 'hiring_owner', status: 'active' },
    { userId: interviewer, workspaceId: 'w1', role: 'interviewer', status: 'active' },
  ]),
  listClients: vi.fn(async () => [{ id: client, name: 'Falcon Pay', archivedAt: null }]),
};
const createJob = vi.fn(async () => ({ id: 'j1' }));

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
vi.mock('@/server/auth', () => ({
  getIdentity: () => ({ getUser: async (id: string) => ({ id, email: 'head.eng@example.com', displayName: null }) }),
}));
vi.mock('@/server/jobs', () => ({ getJobs: () => ({ createJob }) }));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));
vi.mock('next/navigation', () => ({
  forbidden: () => {
    throw new Error('NEXT_HTTP_ERROR_FALLBACK;403');
  },
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT;${to}`);
  },
  unstable_rethrow: (error: unknown) => {
    if (error instanceof Error && error.message.startsWith('NEXT_')) throw error;
  },
}));

const submit = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return addJob(initialNewJobState(''), data);
};
const job = { jobType: 'ai_llm_engineering', title: 'Senior AI Engineer', description: 'LLM systems in production.' };

beforeEach(() => {
  vi.clearAllMocks();
  role = 'recruiter';
  workspaces.getWorkspace.mockResolvedValue({ type: 'in_house', synthetic: true, hiringFocus: 'sales' });
});

describe('addJob (server action)', () => {
  it('saves the job with a synthetic flag from the workspace, never the form, and opens Jobs', async () => {
    await expect(submit({ ...job, hiringOwnerUserId: owner, synthetic: 'false' })).rejects.toThrow(
      'NEXT_REDIRECT;/app/jobs',
    );
    expect(createJob).toHaveBeenCalledWith(expect.objectContaining({ role: 'recruiter' }), {
      ...job,
      team: null,
      clientId: null,
      location: null,
      hiringOwnerUserId: owner,
      synthetic: true,
    });
  });

  // SAFETY: mutation check: removed authorize(ctx, 'job.create') from newJobOptions -> this test failed (job created)
  it.each(['interviewer', 'hiring_owner'] as const)('refuses a %s with 403 and saves nothing', async (r) => {
    role = r;
    await expect(submit(job)).rejects.toThrow('NEXT_HTTP_ERROR_FALLBACK;403');
    expect(createJob).not.toHaveBeenCalled();
  });

  it('asks for a title and saves nothing', async () => {
    await expect(submit({ ...job, title: '' })).resolves.toMatchObject({ errors: { title: true }, error: null });
    expect(createJob).not.toHaveBeenCalled();
  });

  // SAFETY: mutation check: dropped the offered() check -> this test failed (job saved with the interviewer as owner)
  it('refuses a hiring owner the page did not offer', async () => {
    await expect(submit({ ...job, hiringOwnerUserId: interviewer })).resolves.toMatchObject({ error: 'failed' });
    expect(createJob).not.toHaveBeenCalled();
  });

  it("accepts an agency's own client", async () => {
    workspaces.getWorkspace.mockResolvedValue({ type: 'agency', synthetic: true, hiringFocus: 'sales' });
    await expect(submit({ ...job, clientId: client })).rejects.toThrow('NEXT_REDIRECT;/app/jobs');
    expect(createJob).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ clientId: client }));
  });

  it('on a service error keeps what was typed and logs no personal data', async () => {
    const log = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    createJob.mockRejectedValueOnce(new Error('duplicate: Senior AI Engineer'));
    await expect(submit(job)).resolves.toMatchObject({ error: 'failed', values: { title: 'Senior AI Engineer' } });
    expect(log.mock.calls.join('')).not.toContain('Senior AI Engineer');
    log.mockRestore();
  });
});
