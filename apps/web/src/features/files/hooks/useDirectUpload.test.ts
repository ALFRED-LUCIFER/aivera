/** @vitest-environment jsdom */
import type { FileStatus } from '@credalent/files';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useDirectUpload } from './useDirectUpload.ts';

// AIV-P0-016: the upload flow with the server actions and the PUT replaced.
const FILE_ID = '0190d4a2-0000-7000-8000-0000000000f1';
vi.mock('../services/files.ts', () => ({}));

const pdf = (size: number, name = 'eval-set-sample.pdf', type = 'application/pdf') =>
  new File([new Uint8Array(size)], name, { type });

function services(statuses: (FileStatus | null)[]) {
  const [first, ...later] = statuses;
  return {
    requestUpload: vi.fn(async () => ({ ok: true as const, fileId: FILE_ID, uploadUrl: 'https://st.example/sas' })),
    putBlob: vi.fn(async (_url: string, _file: File, _type: string, onProgress: (p: number) => void) => {
      onProgress(50);
      return true;
    }),
    completeUpload: vi.fn(async () => first ?? null),
    uploadStatus: vi.fn(async () => later.shift() ?? null),
    pollMs: 0,
  };
}

const run = async (file: File, s: ReturnType<typeof services>) => {
  const { result } = renderHook(() => useDirectUpload('portal', s));
  await act(() => result.current.onSelect(file));
  return result.current.state;
};

describe('useDirectUpload', () => {
  it('uploads, waits out the scan, and ends with the clean file id', async () => {
    const s = services(['pending', 'pending', 'clean']);
    expect(await run(pdf(2048), s)).toEqual({ phase: 'done', fileId: FILE_ID });
    expect(s.putBlob).toHaveBeenCalledWith(
      'https://st.example/sas',
      expect.any(File),
      'application/pdf',
      expect.any(Function),
    );
    expect(s.uploadStatus).toHaveBeenCalledTimes(2);
  });

  it('Scenario: An infected file never becomes evidence: the uploader sees "We cannot use this file. Upload a PDF, image or document within the size limit."', async () => {
    expect(await run(pdf(2048), services(['pending', 'infected']))).toEqual({ phase: 'error', message: 'notAccepted' });
  });

  it('refuses a file over the limit before asking the server', async () => {
    const s = services(['clean']);
    expect(await run(pdf(21 * 1024 * 1024), s)).toEqual({ phase: 'error', message: 'limits.evidence' });
    expect(s.requestUpload).not.toHaveBeenCalled();
  });

  it('sends the type from the extension when the browser leaves it empty', async () => {
    const s = services(['clean']);
    await run(pdf(10, 'cv.docx', ''), s);
    expect(s.requestUpload).toHaveBeenCalledWith(
      expect.objectContaining({
        contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      }),
    );
  });

  it('a failed PUT, or a server refusal, ends in an error the uploader can retry from', async () => {
    const s = services(['clean']);
    s.putBlob.mockResolvedValueOnce(false);
    expect(await run(pdf(10), s)).toEqual({ phase: 'error', message: 'failed' });
    s.requestUpload.mockResolvedValueOnce({ ok: false, error: 'limits.evidence' } as never);
    expect(await run(pdf(10), s)).toEqual({ phase: 'error', message: 'limits.evidence' });
  });
});
