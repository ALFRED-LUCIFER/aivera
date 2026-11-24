import type { WorkspaceContext } from '@credalent/workspaces';
import { describe, expect, it, vi } from 'vitest';
import { CandidateError, type Person } from '../domain/person.ts';
import { mergeUseCases, type MergePorts } from './merge.ts';

// The merge's re-check after its lock (AIV-P1-018); synthetic cast (docs/00-product/personas.md).
const ctx = { userId: 'ap', workspaceId: 'w1', role: 'recruiter', tx: {} } as unknown as WorkspaceContext;
const person = (id: string, mergedIntoId: string | null): Person => ({
  id,
  workspaceId: 'w1',
  displayName: 'Sneha Iyer',
  emails: [],
  phones: [],
  location: null,
  synthetic: true,
  mergedIntoId,
  createdAt: new Date('2026-11-20T09:00:00.000Z'),
});

/** Merge use cases whose lock finds `b` already merged into `a`, as when another arrival merged them first. */
function mergedMeanwhile() {
  const move = vi.fn();
  const useCases = mergeUseCases({
    storeFor: () => ({ lockPeople: async () => [person('a', null), person('b', 'a')] }) as never,
    authorize: async () => {},
    applications: { move },
    evidence: { move },
  } as unknown as MergePorts);
  return { useCases, move };
}

describe('two arrivals bridging the same pair at once', () => {
  // SAFETY: mutation check: threw merge_people for an automatic merge of a pair merged meanwhile -> this test failed
  it('the second automatic merge finds the pair merged after its lock and skips it, so the upload goes through', async () => {
    const { useCases, move } = mergedMeanwhile();
    await expect(useCases.merge(ctx, 'a', 'b', { reason: 'same CV file', automatic: true })).resolves.toBeNull();
    expect(move).not.toHaveBeenCalled();
  });

  it('a recruiter merging a pair already merged is refused', async () => {
    const { useCases, move } = mergedMeanwhile();
    await expect(useCases.mergePeople(ctx, 'a', 'b', 'Same person')).rejects.toThrow(CandidateError);
    expect(move).not.toHaveBeenCalled();
  });
});
