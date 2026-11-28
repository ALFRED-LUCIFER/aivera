/** @vitest-environment jsdom */
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { DirectUpload } from '@/features/files';
import { useAddApplicantsController } from './useAddApplicantsController.ts';

// AIV-P1-019, AIV-P1-165: several CVs per pick, each listed by its name with its own result, filed in saves of up to
// 200. Uploads are faked; synthetic file names and opaque ids only.
const JOB = '0190d4a2-0000-7000-9000-000000001031';
const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));
vi.mock('../services/addApplicants.ts', () => ({}));
vi.mock('@/features/files', () => ({}));

const MB = 1024 * 1024;
const pdf = (n: number, size = 1024) =>
  new File([new Uint8Array(size)], `cv-sample-${n}.pdf`, { type: 'application/pdf' });
const png = new File([new Uint8Array(10)], 'photo-sample.png', { type: 'image/png' });
const idOf = (name: string) => `0190d4a2-0000-7000-8000-${name.replace(/\D/g, '').padStart(12, '0')}`;

/** Settles every file at once: clean, unless the limits refuse it, as the real uploadFile does first. */
const cleanUpload = vi.fn(async (_p: 'cv', file: File, set: (u: DirectUpload) => void) => {
  set(
    file.type === 'application/pdf' && file.size <= 10 * MB
      ? { phase: 'done', fileId: idOf(file.name) }
      : { phase: 'error', message: 'limits.cv' },
  );
});
const saved = (count: number, created = true) => ({
  ok: true as const,
  applications: Array.from({ length: count }, (_, i) => ({ applicationId: `a${i}`, created })),
});

function setup(
  addApplicants = vi.fn(async (input: { fileIds: string[] }) => saved(input.fileIds.length)),
  uploadFile = cleanUpload,
) {
  const { result } = renderHook(() => useAddApplicantsController(JOB, { addApplicants, uploadFile } as never));
  act(() => result.current.onOpenChange(true));
  return { result, addApplicants, uploadFile };
}
const pick = async (result: ReturnType<typeof setup>['result'], files: File[]) => {
  await act(async () => result.current.onSelectCvs(files));
};
const lines = (result: ReturnType<typeof setup>['result']) =>
  result.current.rows.map((r) => [r.name, r.added ?? (r.upload.phase === 'error' ? r.upload.message : r.upload.phase)]);

describe('Scenario Outline: Several files at once, each validated', () => {
  it('30 PDF and Word CVs: all 30 listed by name and ready', async () => {
    const { result } = setup();
    await pick(
      result,
      Array.from({ length: 30 }, (_, i) => pdf(i)),
    );
    expect(result.current.rows).toHaveLength(30);
    expect(result.current.readyCount).toBe(30);
    expect(result.current.over).toBe(0);
  });

  it('6 CVs and 1 image: 6 ready, the image refused with its reason, in pick order', async () => {
    const { result } = setup();
    await pick(result, [pdf(1), pdf(2), pdf(3), png, pdf(4), pdf(5), pdf(6)]);
    expect(lines(result)).toEqual([
      ['cv-sample-1.pdf', 'done'],
      ['cv-sample-2.pdf', 'done'],
      ['cv-sample-3.pdf', 'done'],
      ['photo-sample.png', 'limits.cv'],
      ['cv-sample-4.pdf', 'done'],
      ['cv-sample-5.pdf', 'done'],
      ['cv-sample-6.pdf', 'done'],
    ]);
  });

  it('1 CV over the size limit and 5 within it: 5 ready, the large one refused with the limit', async () => {
    const { result } = setup();
    await pick(result, [pdf(1, 11 * MB), pdf(2), pdf(3), pdf(4), pdf(5), pdf(6)]);
    expect(lines(result)[0]).toEqual(['cv-sample-1.pdf', 'limits.cv']);
    expect(result.current.readyCount).toBe(5);
  });

  // SAFETY: mutation check: withinSave returned every file (no 200 per save) -> this test failed (201 rows listed)
  it('201 CVs: the first 200 listed, the 201st left out and counted; a later pick has no room left', async () => {
    const { result } = setup();
    const files = Array.from({ length: 201 }, (_, i) => pdf(i));
    await pick(result, files);
    expect(result.current.rows.map((r) => r.name)).toEqual(files.slice(0, 200).map((f) => f.name));
    expect(result.current.over).toBe(1);
    await pick(result, [pdf(999)]);
    expect([result.current.rows.length, result.current.over]).toEqual([200, 1]);
  });

  // The cause of the dev timeout this guards against: every upload polls with server actions, which a tab runs one at a time.
  it('uploads at most three files at a time', async () => {
    let running = 0;
    let most = 0;
    const slow = vi.fn(async (_p: 'cv', file: File, set: (u: DirectUpload) => void) => {
      most = Math.max(most, ++running);
      await new Promise((resolve) => setTimeout(resolve, 1));
      running--;
      set({ phase: 'done', fileId: idOf(file.name) });
    });
    const { result } = setup(undefined, slow);
    await pick(
      result,
      Array.from({ length: 10 }, (_, i) => pdf(i)),
    );
    await waitFor(() => expect(result.current.readyCount).toBe(10));
    expect([slow.mock.calls.length, most]).toEqual([10, 3]);
  });
});

describe('Scenario: Source and consent are asked once', () => {
  it('no source is chosen at first; the tick stays for the next save in this session and is gone when reopened', async () => {
    const { result, addApplicants } = setup();
    expect(result.current.source).toBe('');
    await pick(result, [pdf(1)]);
    act(() => result.current.onConfirmedChange(true));
    // SAFETY: mutation check: removed `source !== null &&` from canSubmit -> this assertion failed (the add button was enabled with no source)
    expect(result.current.canSubmit).toBe(false);
    act(() => result.current.onSourceChange('referral'));
    expect(result.current.canSubmit).toBe(true);
    await act(async () => result.current.onSubmit());
    expect(addApplicants).toHaveBeenCalledWith({
      jobId: JOB,
      rightToProcessConfirmed: true,
      source: 'referral',
      fileIds: [idOf('cv-sample-1.pdf')],
    });
    await pick(result, [pdf(2)]);
    expect([result.current.confirmed, result.current.canSubmit]).toEqual([true, true]);
    act(() => result.current.onOpenChange(false));
    act(() => result.current.onOpenChange(true));
    expect([result.current.confirmed, result.current.source, result.current.rows]).toEqual([false, '', []]);
  });

  // AIV-P1-104. SAFETY: mutation check: removed `confirmed &&` from canSubmit -> this assertion failed (the add button was enabled unticked)
  it('the add button waits for the tick', async () => {
    const { result } = setup();
    await pick(result, [pdf(1)]);
    act(() => result.current.onSourceChange('email'));
    expect(result.current.canSubmit).toBe(false);
  });
});

describe('Scenario: After adding, go to the ranking', () => {
  it('the added file names stay listed with their result, and the ranking is the next step', async () => {
    const addApplicants = vi.fn(async () => ({
      ok: true as const,
      applications: [
        { applicationId: 'a1', created: true },
        { applicationId: 'a2', created: false },
      ],
    }));
    const { result } = setup(addApplicants);
    await pick(result, [pdf(1), png, pdf(2)]);
    expect(result.current.rankingHref).toBeNull();
    act(() => result.current.onSourceChange('linkedin'));
    act(() => result.current.onConfirmedChange(true));
    await act(async () => result.current.onSubmit());
    expect(lines(result)).toEqual([
      ['cv-sample-1.pdf', 'created'],
      ['photo-sample.png', 'limits.cv'],
      ['cv-sample-2.pdf', 'sourceAdded'],
    ]);
    expect(result.current.rankingHref).toBe(`/app/jobs/${JOB}/candidates`);
    // The job header's count and the ranking re-read the new applicants (AIV-P1-086).
    expect(refresh).toHaveBeenCalled();
    // A new CV waiting for a save makes adding the next step again.
    await pick(result, [pdf(3)]);
    expect([result.current.rankingHref, result.current.readyCount]).toEqual([null, 1]);
  });
});

// AIV-P2-064. SAFETY: mutation check: removed the try/catch in onSubmit -> this test failed (unhandled rejection)
it.each([
  [new TypeError('Failed to fetch'), 'saveFailed'],
  [Object.assign(new Error('x'), { digest: 'NEXT_HTTP_ERROR_FALLBACK;403' }), 'saveForbidden'],
] as const)(
  'Scenario Outline: A rejected save keeps the form: %s shows %s, the CVs and source stay',
  async (error, failure) => {
    const { result } = setup(vi.fn(async () => Promise.reject(error)));
    await pick(result, [pdf(1)]);
    act(() => result.current.onSourceChange('referral'));
    act(() => result.current.onConfirmedChange(true));
    await act(async () => result.current.onSubmit());
    expect([result.current.failure, result.current.source, result.current.readyCount]).toEqual([
      failure,
      'referral',
      1,
    ]);
    expect([result.current.canSubmit, result.current.pending]).toEqual([true, false]);
  },
);

it('Scenario: An old error does not return: closing the dialog drops running uploads and clears the list', async () => {
  const gate = Promise.withResolvers<void>();
  const hanging = vi.fn(async (_p: 'cv', file: File, set: (u: DirectUpload) => void) => {
    set({ phase: 'uploading', percent: 10 });
    await gate.promise;
    set({ phase: 'done', fileId: idOf(file.name) });
  });
  const { result } = setup(undefined, hanging);
  await pick(result, [pdf(1)]);
  act(() => result.current.onOpenChange(false));
  await act(async () => gate.resolve());
  expect([result.current.rows, result.current.failure]).toEqual([[], null]);
});
