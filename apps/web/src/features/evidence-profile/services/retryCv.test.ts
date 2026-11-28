import { EvidenceError } from '@credalent/evidence';
import { log } from '@credalent/observability';
import { ForbiddenError } from '@credalent/workspaces';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { retryCv } from './retryCv.ts';

// AIV-P1-134, AIV-P1-165: "Try again" on a CV. Evidence is replaced; its rules, roles, audit and row-level security are
// proven against PostgreSQL in tests/integration/src/cv-parse.test.ts and evidence-mapping.test.ts.
const SOURCE = '0190d4a2-0000-7000-8000-0000000000c1';
const CANDIDATE = '0190d4a2-0000-7000-8000-0000000000a1';
const JOB = '0190d4a2-0000-7000-9000-000000001031';
const ctx = {};
const evidence = vi.hoisted(() => ({ retryCvParse: vi.fn(), retryMapping: vi.fn() }));
vi.mock('@/server/evidence', () => ({ getEvidence: () => evidence }));
vi.mock('@/server/workspace', () => ({
  inActiveWorkspace: async (fn: (c: object) => unknown) => ({ value: await fn(ctx) }),
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

beforeEach(() => vi.clearAllMocks());

describe('the CV "Try again" action', () => {
  it('a failed CV is read again by its source id only', async () => {
    expect(await retryCv({ kind: 'cv', sourceId: SOURCE })).toEqual({ ok: true });
    expect(evidence.retryCvParse).toHaveBeenCalledWith(ctx, SOURCE);
    expect(evidence.retryMapping).not.toHaveBeenCalled();
  });

  // SAFETY: mutation check: logged the whole input (`...target`) -> this test failed (kind in the log)
  it('logs the opaque source id and the outcome only (AIV-P1-134: carries no personal data)', async () => {
    const info = vi.spyOn(log, 'info');
    await retryCv({ kind: 'cv', sourceId: SOURCE });
    expect(info.mock.calls).toEqual([[{ area: 'candidates', code: 'cv', sourceId: SOURCE }, 'cv retry queued']]);
    info.mockRestore();
  });

  it("a failed assessment re-runs that candidate's for that job only", async () => {
    expect(await retryCv({ kind: 'mapping', candidateId: CANDIDATE, jobId: JOB })).toEqual({ ok: true });
    expect(evidence.retryMapping).toHaveBeenCalledWith(ctx, CANDIDATE, JOB);
  });

  it.each([
    { kind: 'cv', sourceId: 'not-a-uuid' },
    { kind: 'cv', sourceId: SOURCE, fileName: 'cv.pdf' },
    { kind: 'mapping', candidateId: CANDIDATE },
    { kind: 'anything', sourceId: SOURCE },
  ])('an input that is not opaque ids of one target is refused before anything runs (%#)', async (input) => {
    expect(await retryCv(input)).toEqual({ ok: false, error: 'invalid' });
    expect(evidence.retryCvParse).not.toHaveBeenCalled();
  });

  // SAFETY: mutation check: dropped `if (error instanceof ForbiddenError) forbidden()` -> this test failed ('failed')
  it('a hiring owner or interviewer, whom evidence refuses, gets the 403 page', async () => {
    evidence.retryCvParse.mockRejectedValueOnce(new ForbiddenError());
    await expect(retryCv({ kind: 'cv', sourceId: SOURCE })).rejects.toThrow('403');
  });

  it("another workspace's CV is not found", async () => {
    evidence.retryCvParse.mockRejectedValueOnce(new EvidenceError('cv_not_found'));
    await expect(retryCv({ kind: 'cv', sourceId: SOURCE })).rejects.toThrow('404');
  });

  it('a CV that is not failed (a second retry included) is refused, with nothing changed', async () => {
    evidence.retryCvParse.mockRejectedValueOnce(new EvidenceError('not_retryable'));
    expect(await retryCv({ kind: 'cv', sourceId: SOURCE })).toEqual({ ok: false, error: 'refused' });
  });
});
