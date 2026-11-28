/** @vitest-environment jsdom */
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReviewView } from '../domain/rubric.ts';
import { useRubricDecisionController } from './useRubricDecisionController.ts';
import { useRubricEditController } from './useRubricEditController.ts';

// AIV-P2-064: a rubric save or decision that throws keeps the edits and says so. Synthetic opaque ids only.
const JOB = '0190d4a2-0000-7000-9000-000000002064';
const VERSION = '0190d4a2-0000-7000-8000-000000002064';
const forbidden = Object.assign(new Error('NEXT_HTTP_ERROR_FALLBACK;403'), { digest: 'NEXT_HTTP_ERROR_FALLBACK;403' });
const refresh = vi.fn();
const saveRubricDraft = vi.fn();
const decideRubric = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));
vi.mock('../services/saveRubricDraft.ts', () => ({ saveRubricDraft: (...a: unknown[]) => saveRubricDraft(...a) }));
vi.mock('../services/decideRubric.ts', () => ({ decideRubric: (...a: unknown[]) => decideRubric(...a) }));
vi.mock('../services/sendRubricForApproval.ts', () => ({ sendRubricForApproval: vi.fn() }));

const competency = {
  name: 'API design',
  evidenceExpected: 'A public API',
  weightPercent: 100,
  levelNeeded: 3,
  type: 'mandatory' as const,
  origin: 'added_by_recruiter' as const,
};
const edit = { base: { versionId: VERSION, revision: 1 }, successStatement: '', competencies: [competency] };
const review: ReviewView = {
  versionId: VERSION,
  revision: 1,
  version: 2,
  changeNote: null,
  approvedVersion: 1,
  successStatement: '',
  competencies: [competency],
} as ReviewView;

beforeEach(() => vi.resetAllMocks());

// AIV-P1-165 "Approving is confirmed and audited".
describe('Scenario: Approving is confirmed', () => {
  // SAFETY: mutation check: called decideRubric from onApprovingChange(true) -> this test failed (approved on open)
  it('opening and cancelling the preview calls nothing; Confirm sends the reason once', async () => {
    decideRubric.mockResolvedValue({ ok: true });
    const { result } = renderHook(() => useRubricDecisionController(JOB, review));
    act(() => result.current.onApprovingChange(true));
    act(() => result.current.onReason('Matches the job description'));
    act(() => result.current.onApprovingChange(false));
    expect(decideRubric).not.toHaveBeenCalled();
    expect(result.current.status).toBe('idle');

    act(() => result.current.onApprovingChange(true));
    await act(() => result.current.onApprove());
    expect(decideRubric).toHaveBeenCalledExactlyOnceWith({
      jobId: JOB,
      versionId: VERSION,
      revision: 1,
      reason: 'Matches the job description',
    });
    expect([result.current.status, result.current.approving]).toEqual(['approved', false]);
  });
});

describe('Scenario Outline: A rejected save keeps the form', () => {
  // SAFETY: mutation check: removed the try/catch in useRubricEditController -> this test failed (unhandled rejection)
  it.each([
    [new TypeError('Failed to fetch'), 'saveFailed'],
    [forbidden, 'saveForbidden'],
  ] as const)('rubric editor: %s shows %s, the edits stay and save is enabled', async (error, status) => {
    saveRubricDraft.mockRejectedValueOnce(error);
    const { result } = renderHook(() => useRubricEditController(JOB, edit));
    act(() => result.current.onStart());
    act(() => result.current.onChange(0, { name: 'API design and review' }));
    await act(async () => result.current.onSave());
    expect(result.current.status).toBe(status);
    expect([result.current.editing, result.current.competencies[0]?.name]).toEqual([true, 'API design and review']);
    expect([result.current.canSave, result.current.pending]).toEqual([true, false]);
    expect(refresh).not.toHaveBeenCalled();
  });

  // SAFETY: mutation check: removed the try/catch in useRubricDecisionController -> this test failed (unhandled rejection)
  it.each([
    [new TypeError('Failed to fetch'), 'saveFailed'],
    [forbidden, 'saveForbidden'],
  ] as const)('rubric decision: %s shows %s and the return note stays', async (error, status) => {
    decideRubric.mockRejectedValueOnce(error);
    const { result } = renderHook(() => useRubricDecisionController(JOB, review));
    act(() => result.current.onStartReturn());
    act(() => result.current.onNote('Weight the API work higher.'));
    await act(async () => result.current.onReturn());
    expect(result.current.status).toBe(status);
    expect([result.current.returning, result.current.note, result.current.pending]).toEqual([
      true,
      'Weight the API work higher.',
      false,
    ]);
  });
});
