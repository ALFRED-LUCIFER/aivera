import { PackError } from '@credalent/decisions';
import { ForbiddenError } from '@credalent/workspaces';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { recordDecisions } from './recordDecisions.ts';

// AIV-P2-012: the action the hiring owner records a pack's decisions with. Decisions is replaced; its checks are proven
// against PostgreSQL in tests/integration/src/decisions.test.ts and record-decisions.test.ts. Synthetic ids only.
const id = (n: number) => `0190d4a2-0000-7000-8000-${String(n).padStart(12, '0')}`;
const PACK = id(2);
const [SARA, HUDA] = [id(21), id(22)];
const WHY = 'Strong on the two heaviest competencies.';
const decisions = { recordDecisions: vi.fn() };
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

const input = (reason = WHY) => ({
  packId: PACK,
  decisions: [
    { candidateId: SARA, decision: 'advance' },
    { candidateId: HUDA, decision: 'do_not_advance' },
  ],
  reason,
});

beforeEach(() => {
  vi.clearAllMocks();
  decisions.recordDecisions.mockResolvedValue(undefined);
});

describe('recordDecisions', () => {
  it('records each decision with the one reason as its note', async () => {
    expect(await recordDecisions(input(`  ${WHY} `))).toEqual({ ok: true });
    expect(decisions.recordDecisions).toHaveBeenCalledWith(
      {},
      {
        packId: PACK,
        decisions: [
          { candidateId: SARA, decision: 'advance', note: WHY },
          { candidateId: HUDA, decision: 'do_not_advance', note: WHY },
        ],
      },
    );
  });

  it('Scenario: Only the authorised hiring owner: the module refuses anyone else, and the request gets the 403 page', async () => {
    decisions.recordDecisions.mockRejectedValue(new ForbiddenError());
    await expect(recordDecisions(input())).rejects.toThrow('NEXT_HTTP_ERROR_FALLBACK;403');
  });

  it('a pack already decided, another workspace’s pack, a missing reason or decision value, and a failure', async () => {
    decisions.recordDecisions.mockRejectedValueOnce(new PackError('pack_decided'));
    expect(await recordDecisions(input())).toEqual({ ok: false, error: 'decided' });
    decisions.recordDecisions.mockRejectedValueOnce(new PackError('pack_not_found'));
    await expect(recordDecisions(input())).rejects.toThrow('NEXT_HTTP_ERROR_FALLBACK;404');
    decisions.recordDecisions.mockRejectedValueOnce(new Error('connection reset'));
    expect(await recordDecisions(input())).toEqual({ ok: false, error: 'failed' });
    decisions.recordDecisions.mockClear();
    expect(await recordDecisions(input('  '))).toEqual({ ok: false, error: 'invalid' });
    expect(await recordDecisions({ ...input(), decisions: [{ candidateId: SARA, decision: 'reject' }] })).toEqual({
      ok: false,
      error: 'invalid',
    });
    expect(decisions.recordDecisions).not.toHaveBeenCalled();
  });
});
