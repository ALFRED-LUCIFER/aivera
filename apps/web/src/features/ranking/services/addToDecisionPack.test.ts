import { PackError } from '@credalent/decisions';
import { ForbiddenError } from '@credalent/workspaces';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { addToDecisionPack } from './addToDecisionPack.ts';

// AIV-P2-010: the action a recruiter adds candidates to a decision pack with. Intake and decisions are replaced; their
// checks are proven against PostgreSQL in tests/integration/src/decisions.test.ts. Synthetic ids only.
const id = (n: number) => `0190d4a2-0000-7000-8000-${String(n).padStart(12, '0')}`;
const JOB = id(1);
const PACK = id(2);
const [SARA_APP, ARJUN_APP, OTHER_JOB_APP] = [id(11), id(12), id(13)];
const intake = { listApplicationsForJob: vi.fn() };
const decisions = { createPack: vi.fn(), addMembers: vi.fn() };
vi.mock('@/server/intake', () => ({ getIntake: () => intake }));
vi.mock('@/server/decisions', () => ({ getDecisions: () => decisions }));
vi.mock('@/server/workspace', () => ({
  inActiveWorkspace: async (fn: (ctx: object) => unknown) => ({ value: await fn({}) }),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({
  forbidden: () => {
    throw new Error('NEXT_HTTP_ERROR_FALLBACK;403');
  },
  notFound: () => {
    throw new Error('NEXT_HTTP_ERROR_FALLBACK;404');
  },
  unstable_rethrow: (error: unknown) => {
    if (error instanceof Error && error.message.startsWith('NEXT_')) throw error;
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  intake.listApplicationsForJob.mockResolvedValue([
    { applicationId: SARA_APP, personId: 'p-sara' },
    { applicationId: ARJUN_APP, personId: 'p-arjun' },
  ]);
});

describe('addToDecisionPack', () => {
  it('creates a named pack of the selected applicants, by person id', async () => {
    decisions.createPack.mockResolvedValue({ packId: PACK });
    const result = await addToDecisionPack({
      jobId: JOB,
      applicationIds: [SARA_APP, ARJUN_APP],
      pack: { name: 'Round 2 shortlist' },
    });
    expect(result).toEqual({ ok: true, packId: PACK, added: 2 });
    expect(decisions.createPack).toHaveBeenCalledWith(
      {},
      { jobId: JOB, name: 'Round 2 shortlist', members: [{ candidateId: 'p-sara' }, { candidateId: 'p-arjun' }] },
    );
  });

  it('adds to an existing pack', async () => {
    decisions.addMembers.mockResolvedValue({ added: 1 });
    expect(await addToDecisionPack({ jobId: JOB, applicationIds: [ARJUN_APP], pack: { packId: PACK } })).toEqual({
      ok: true,
      packId: PACK,
      added: 1,
    });
    expect(decisions.addMembers).toHaveBeenCalledWith({}, PACK, [{ candidateId: 'p-arjun' }]);
  });

  // SAFETY: mutation check: removed the `members.some((m) => m === undefined)` refusal -> this test failed (createPack called with Sara only)
  it('an application that is not this job’s refuses the whole addition, writing nothing', async () => {
    const result = await addToDecisionPack({
      jobId: JOB,
      applicationIds: [SARA_APP, OTHER_JOB_APP],
      pack: { name: 'Round 2 shortlist' },
    });
    expect(result).toEqual({ ok: false, error: 'notOnJob' });
    expect(decisions.createPack).not.toHaveBeenCalled();
    expect(decisions.addMembers).not.toHaveBeenCalled();
  });

  it('a refused pack change, a role refusal and a malformed input', async () => {
    decisions.addMembers.mockRejectedValueOnce(new PackError('pack_decided'));
    expect(await addToDecisionPack({ jobId: JOB, applicationIds: [SARA_APP], pack: { packId: PACK } })).toEqual({
      ok: false,
      error: 'refused',
    });
    decisions.addMembers.mockRejectedValueOnce(new ForbiddenError());
    await expect(addToDecisionPack({ jobId: JOB, applicationIds: [SARA_APP], pack: { packId: PACK } })).rejects.toThrow(
      '403',
    );
    expect(await addToDecisionPack({ jobId: JOB, applicationIds: [], pack: { name: '' } })).toEqual({
      ok: false,
      error: 'invalid',
    });
  });
});
