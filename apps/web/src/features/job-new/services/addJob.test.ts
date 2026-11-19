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
const createJobWithDraftRubric = vi.fn(async () => ({ job: { id: 'j1' }, rubricVersion: { id: 'v1' } }));

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
  getIdentity: () => ({ getUser: async (id: string) => ({ id, email: 'hassan@example.com', displayName: null }) }),
}));
vi.mock('@/server/jobs', () => ({ getJobs: () => ({ createJobWithDraftRubric }) }));
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

const competency = {
  name: 'Arabic and bilingual NLP',
  evidenceExpected: 'Work on Arabic or bilingual text',
  weightPercent: 10,
  levelNeeded: 2,
  type: 'desirable',
  origin: 'suggested_by_aivera',
};
const rubric = JSON.stringify([competency]);
const submit = (fields: Record<string, string>) => {
  const data = new FormData();
  data.set('rubric', rubric);
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
  it('saves the job and its rubric, synthetic from the workspace, never the form, and shows the saved state', async () => {
    await expect(submit({ ...job, hiringOwnerUserId: owner, synthetic: 'false' })).resolves.toMatchObject({
      saved: true,
      rubricVersionId: 'v1',
      error: null,
    });
    expect(createJobWithDraftRubric).toHaveBeenCalledWith(expect.objectContaining({ role: 'recruiter' }), {
      ...job,
      team: null,
      clientId: null,
      location: null,
      hiringOwnerUserId: owner,
      synthetic: true,
      // Scenario: Kept suggestions are marked (AIV-P1-009): the origin reaches the jobs module as posted.
      competencies: [{ ...competency, packKey: null, packVersion: null }],
    });
  });

  // Scenario: I decide what stays (AIV-P1-064): a kept pack competency reaches the jobs module with its pack.
  it('saves a pack competency with origin domain_pack, its pack key and the catalogue version', async () => {
    const pack = {
      ...competency,
      name: '3-D Secure and SCA flows',
      origin: 'domain_pack',
      packKey: 'payments_fintech',
      packVersion: 1,
    };
    const data = new FormData();
    for (const [key, value] of Object.entries(job)) data.set(key, value);
    data.set('rubric', JSON.stringify([pack]));
    await expect(addJob(initialNewJobState(''), data)).resolves.toMatchObject({ saved: true });
    expect(createJobWithDraftRubric).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ competencies: [pack] }),
    );
  });

  // Scenario: Validation (AIV-P1-010): the server refuses what the page would have blocked.
  // SAFETY: mutation check: parseRubric parsed z.array(z.any()) -> the name, level, weight and origin cases failed
  it.each([
    ['no competency', '[]'],
    ['a competency with no name', JSON.stringify([{ ...competency, name: ' ' }])],
    ['a level outside 1 to 5', JSON.stringify([{ ...competency, levelNeeded: 6 }])],
    ['a weight of 0', JSON.stringify([{ ...competency, weightPercent: 0 }])],
    ['an unknown origin', JSON.stringify([{ ...competency, origin: 'imported' }])],
    ['text that is not JSON', 'not json'],
  ])('refuses %s and stores nothing', async (_case, value) => {
    const data = new FormData();
    for (const [key, v] of Object.entries(job)) data.set(key, v);
    data.set('rubric', value);
    await expect(addJob(initialNewJobState(''), data)).resolves.toMatchObject({ error: 'failed', saved: false });
    expect(createJobWithDraftRubric).not.toHaveBeenCalled();
  });

  // SAFETY: mutation check: removed authorize(ctx, 'job.create') from newJobOptions -> this test failed (job created)
  it.each(['interviewer', 'hiring_owner'] as const)('refuses a %s with 403 and saves nothing', async (r) => {
    role = r;
    await expect(submit(job)).rejects.toThrow('NEXT_HTTP_ERROR_FALLBACK;403');
    expect(createJobWithDraftRubric).not.toHaveBeenCalled();
  });

  it('asks for a title and saves nothing', async () => {
    await expect(submit({ ...job, title: '' })).resolves.toMatchObject({ errors: { title: true }, error: null });
    expect(createJobWithDraftRubric).not.toHaveBeenCalled();
  });

  // SAFETY: mutation check: dropped the offered() check -> this test failed (job saved with the interviewer as owner)
  it('refuses a hiring owner the page did not offer', async () => {
    await expect(submit({ ...job, hiringOwnerUserId: interviewer })).resolves.toMatchObject({ error: 'failed' });
    expect(createJobWithDraftRubric).not.toHaveBeenCalled();
  });

  it("accepts an agency's own client", async () => {
    workspaces.getWorkspace.mockResolvedValue({ type: 'agency', synthetic: true, hiringFocus: 'sales' });
    await expect(submit({ ...job, clientId: client })).resolves.toMatchObject({ saved: true });
    expect(createJobWithDraftRubric).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ clientId: client }),
    );
  });

  it('on a service error keeps what was typed and logs no personal data', async () => {
    const log = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    createJobWithDraftRubric.mockRejectedValueOnce(new Error('duplicate: Senior AI Engineer'));
    // Scenario: Save fails: the edits stay (values here, the rows in the page), and nothing is reported saved.
    await expect(submit(job)).resolves.toMatchObject({
      error: 'failed',
      saved: false,
      values: { title: 'Senior AI Engineer' },
    });
    expect(log.mock.calls.join('')).not.toContain('Senior AI Engineer');
    log.mockRestore();
  });
});
