/** @vitest-environment jsdom */
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { DirectUpload } from '@/features/files';
import { useAddApplicantsController } from './useAddApplicantsController.ts';

// AIV-P1-019: a CV joins the list only once the files module reports it clean. Synthetic opaque ids only.
const JOB = '0190d4a2-0000-7000-9000-000000001031';
const F1 = '0190d4a2-0000-7000-8000-0000000000f1';
let state: DirectUpload = { phase: 'idle' };
const refresh = vi.fn();
const reset = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));
vi.mock('../services/addApplicants.ts', () => ({}));
vi.mock('@/features/files', () => ({
  useDirectUpload: () => ({ state, onSelect: vi.fn(async () => undefined), reset, accept: '.pdf,.docx' }),
}));

describe('useAddApplicantsController', () => {
  it('lists a CV once it is clean, never while checking or refused, files it with the source, then refreshes the tab', async () => {
    const addApplicants = vi.fn(async () => ({
      ok: true as const,
      applications: [{ applicationId: 'a', created: true }],
    }));
    const { result, rerender } = renderHook(() => useAddApplicantsController(JOB, { addApplicants }));
    act(() => result.current.onSelectCv(new File(['%PDF'], 'cv-sample.pdf', { type: 'application/pdf' })));
    for (const next of [{ phase: 'checking' }, { phase: 'error', message: 'notAccepted' }] as DirectUpload[]) {
      state = next;
      rerender();
      expect([result.current.cvs, result.current.canSubmit]).toEqual([[], false]);
    }
    state = { phase: 'done', fileId: F1 };
    rerender();
    expect(result.current.cvs).toEqual([{ fileId: F1, name: 'cv-sample.pdf' }]);

    act(() => result.current.onSourceChange('referral'));
    await act(async () => result.current.onSubmit());
    expect(addApplicants).toHaveBeenCalledWith({ jobId: JOB, source: 'referral', fileIds: [F1] });
    expect([result.current.result?.ok, result.current.cvs]).toEqual([true, []]);
    // The Candidates tab re-reads its applicant list (AIV-P1-086).
    expect(refresh).toHaveBeenCalledOnce();
  });

  // AIV-P2-064. SAFETY: mutation check: removed the try/catch in onSubmit -> this test failed (unhandled rejection)
  it.each([
    [new TypeError('Failed to fetch'), 'saveFailed'],
    [Object.assign(new Error('x'), { digest: 'NEXT_HTTP_ERROR_FALLBACK;403' }), 'saveForbidden'],
  ] as const)(
    'Scenario Outline: A rejected save keeps the form: %s shows %s, the CVs and source stay',
    async (error, failure) => {
      const addApplicants = vi.fn(async () => Promise.reject(error));
      state = { phase: 'done', fileId: F1 };
      const { result } = renderHook(() => useAddApplicantsController(JOB, { addApplicants }));
      act(() => result.current.onSourceChange('referral'));
      await act(async () => result.current.onSubmit());
      expect([result.current.failure, result.current.source, result.current.cvs.length]).toEqual([
        failure,
        'referral',
        1,
      ]);
      expect([result.current.canSubmit, result.current.pending]).toEqual([true, false]);
    },
  );

  it('Scenario: An old error does not return: closing the dialog clears the upload and the failure', () => {
    const { result } = renderHook(() => useAddApplicantsController(JOB, { addApplicants: vi.fn() }));
    act(() => result.current.onOpenChange(false));
    expect(reset).toHaveBeenCalledOnce();
    expect(result.current.failure).toBeNull();
  });
});
