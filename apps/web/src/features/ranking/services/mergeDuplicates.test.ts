import { CandidateError } from '@credalent/candidates';
import { ForbiddenError } from '@credalent/workspaces';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mergeDuplicate, undoMerge } from './mergeDuplicates.ts';

// AIV-P1-018: the actions a recruiter merges and an admin undoes with. The candidates module is replaced; its role
// checks are proven against PostgreSQL in tests/integration/src/duplicates.test.ts.
const SURVIVOR = '0190d4a2-0000-7000-8000-0000000000a1';
const MERGED = '0190d4a2-0000-7000-8000-0000000000a2';
const MERGE = '0190d4a2-0000-7000-8000-0000000000b1';
const candidates = { mergePeople: vi.fn(), unmergePeople: vi.fn() };
vi.mock('@/server/people', () => ({ getCandidates: () => candidates }));
vi.mock('@/server/workspace', () => ({
  inActiveWorkspace: async (fn: (ctx: object) => unknown) => ({ value: await fn({}) }),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({
  forbidden: () => {
    throw new Error('NEXT_HTTP_ERROR_FALLBACK;403');
  },
  unstable_rethrow: (error: unknown) => {
    if (error instanceof Error && error.message.startsWith('NEXT_')) throw error;
  },
}));

const merge = () => mergeDuplicate({ survivorId: SURVIVOR, mergedId: MERGED, reason: 'Same CV' });
const undo = () => undoMerge({ mergeId: MERGE, reason: 'Two different people' });

beforeEach(() => vi.clearAllMocks());

describe('the merge and undo actions', () => {
  it('a confirmed merge or undo reaches the module with the ids and reason', async () => {
    expect(await merge()).toEqual({ ok: true });
    expect(candidates.mergePeople).toHaveBeenCalledWith({}, SURVIVOR, MERGED, 'Same CV');
    expect(await undo()).toEqual({ ok: true });
    expect(candidates.unmergePeople).toHaveBeenCalledWith({}, MERGE, 'Two different people');
  });

  // SAFETY: mutation check: dropped `if (error instanceof ForbiddenError) forbidden()` from run -> this test failed (came back as 'failed')
  it("a role the module refuses (an interviewer's merge, a recruiter's undo) is the 403 page", async () => {
    candidates.mergePeople.mockRejectedValueOnce(new ForbiddenError());
    await expect(merge()).rejects.toThrow('403');
    candidates.unmergePeople.mockRejectedValueOnce(new ForbiddenError());
    await expect(undo()).rejects.toThrow('403');
  });

  it('a merge the module refuses (already merged, the undo window passed) comes back as refused', async () => {
    candidates.mergePeople.mockRejectedValueOnce(new CandidateError('merge_people'));
    expect(await merge()).toEqual({ ok: false, error: 'refused' });
    candidates.unmergePeople.mockRejectedValueOnce(new CandidateError('undo_expired'));
    expect(await undo()).toEqual({ ok: false, error: 'refused' });
  });

  it('a malformed request or an empty reason is refused before the module is called', async () => {
    expect(await mergeDuplicate({ survivorId: 'x', mergedId: MERGED, reason: 'Same CV' })).toEqual({
      ok: false,
      error: 'invalid',
    });
    expect(await undoMerge({ mergeId: MERGE, reason: '  ' })).toEqual({ ok: false, error: 'invalid' });
    expect(candidates.mergePeople).not.toHaveBeenCalled();
    expect(candidates.unmergePeople).not.toHaveBeenCalled();
  });
});
