/** @vitest-environment jsdom */
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CATALOGUE_V1 } from '@/test/catalogue-v1.ts';
import type { DraftResult } from '../domain/draft.ts';
import { useCompetencyDraftController } from './useCompetencyDraftController.ts';
import { useNewJobController } from './useNewJobController.ts';

// AIV-P2-064: a draft or save that throws keeps the rows and fields; a re-draft asks before replacing the rows.
const forbidden = Object.assign(new Error('NEXT_HTTP_ERROR_FALLBACK;403'), { digest: 'NEXT_HTTP_ERROR_FALLBACK;403' });
const draftCompetencies = vi.fn<(form: FormData) => Promise<DraftResult>>();
const addJob = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('../services/draftCompetencies.ts', () => ({ draftCompetencies: (f: FormData) => draftCompetencies(f) }));
vi.mock('../services/addJob.ts', () => ({ addJob: (...a: unknown[]) => addJob(...a) }));

const jobType = CATALOGUE_V1.jobTypes[0]?.key ?? '';
const form = () => {
  const f = document.createElement('form');
  f.innerHTML = `<input name="jobType" value="${jobType}"><input name="title" value="Platform engineer">`;
  return f;
};
const drafted = (names: string[]): DraftResult => ({
  status: 'drafted',
  competencies: names.map((name) => ({
    name,
    evidenceExpected: '',
    weightPercent: 20,
    levelNeeded: 3,
    type: 'mandatory',
    origin: 'from_description',
    why: null,
    excerpts: [],
    pack: null,
  })),
  leftOutNonSkill: false,
  jobType,
  industry: null,
  regions: [],
});

beforeEach(() => vi.resetAllMocks());

describe('competency draft', () => {
  // SAFETY: mutation check: removed the try/catch in useCompetencyDraftController -> this test failed (unhandled rejection)
  it.each([
    [new TypeError('Failed to fetch'), 'saveFailed'],
    [forbidden, 'saveForbidden'],
  ] as const)(
    'Scenario Outline: A rejected save keeps the form: %s shows %s and the rows stay',
    async (error, status) => {
      draftCompetencies.mockResolvedValueOnce(drafted(['API design', 'Testing']));
      const { result } = renderHook(() => useCompetencyDraftController(CATALOGUE_V1));
      await act(async () => result.current.onDraft(form()));
      const [first] = result.current.rows;
      act(() => result.current.onChange(first?.id ?? '', { name: 'API design and review' }));

      draftCompetencies.mockRejectedValueOnce(error);
      act(() => result.current.onDraft(form()));
      await act(async () => result.current.onConfirmRedraft());
      expect(result.current.result.status).toBe(status);
      expect(result.current.rows.map((r) => r.name)).toEqual(['API design and review', 'Testing']);
      expect(result.current.drafting).toBe(false);
    },
  );

  // SAFETY: mutation check: made onDraft always run the draft -> this test failed (rows replaced without a confirm)
  it('Scenario: Re-drafting asks before replacing edits', async () => {
    draftCompetencies.mockResolvedValueOnce(drafted(['API design', 'Testing', 'Security', 'Cloud', 'Mentoring']));
    const { result } = renderHook(() => useCompetencyDraftController(CATALOGUE_V1));
    await act(async () => result.current.onDraft(form()));
    expect(result.current.replacing).toBeNull();
    const [a, b] = result.current.rows;
    act(() => result.current.onChange(a?.id ?? '', { name: 'API design and review' }));
    act(() => result.current.onChange(b?.id ?? '', { weightPercent: 30 }));

    act(() => result.current.onDraft(form()));
    expect(result.current.replacing).toEqual(['API design and review', 'Testing', 'Security', 'Cloud', 'Mentoring']);
    expect(draftCompetencies).toHaveBeenCalledOnce();
    act(() => result.current.onCancelRedraft());
    expect([result.current.replacing, result.current.rows[0]?.name]).toEqual([null, 'API design and review']);

    draftCompetencies.mockResolvedValueOnce(drafted(['Go']));
    act(() => result.current.onDraft(form()));
    await act(async () => result.current.onConfirmRedraft());
    expect([result.current.replacing, result.current.rows.map((r) => r.name)]).toEqual([null, ['Go']]);
  });
});

describe('Save job and rubric', () => {
  // SAFETY: mutation check: removed the try/catch around addJob in useNewJobController -> this test failed (the
  // rejection reached the error boundary)
  it.each([
    [new TypeError('Failed to fetch'), 'saveFailed'],
    [forbidden, 'saveForbidden'],
  ] as const)('a thrown save (%s) shows %s with the fields as typed', async (error, message) => {
    addJob.mockRejectedValueOnce(error);
    const { result } = renderHook(() => useNewJobController(jobType));
    const data = new FormData(form());
    await act(async () => result.current.action(data));
    expect(result.current.state).toMatchObject({
      error: message,
      saved: false,
      values: { title: 'Platform engineer' },
    });
    expect(result.current.pending).toBe(false);
  });
});
