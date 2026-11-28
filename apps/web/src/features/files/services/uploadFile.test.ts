import type { FileStatus } from '@credalent/files';
import { describe, expect, it, vi } from 'vitest';
import type { DirectUpload } from '../domain/files.ts';
import { uploadFile } from './uploadFile.ts';

// AIV-P0-016: the upload flow with the server actions and the PUT replaced.
const FILE_ID = '0190d4a2-0000-7000-8000-0000000000f1';
vi.mock('./files.ts', () => ({}));

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
    maxPolls: 90,
  };
}

const run = async (file: File, s: ReturnType<typeof services>, alive = () => true) => {
  let state: DirectUpload = { phase: 'idle' };
  await uploadFile('portal', file, (next) => (state = next), alive, s as never);
  return state;
};

describe('uploadFile', () => {
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

  it('Scenario: An infected file never becomes evidence: the uploader sees "We cannot use this file. Try a different file."', async () => {
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

  // AIV-P2-064. SAFETY: mutation check: dropped the `slow` state -> this test failed
  it('Scenario: A slow scan is not shown as failed: past the usual wait it says "Still checking" and keeps polling', async () => {
    const s = { ...services(['pending']), maxPolls: 2 };
    s.uploadStatus.mockResolvedValueOnce('pending').mockResolvedValueOnce('pending').mockResolvedValueOnce('clean');
    const states: DirectUpload[] = [];
    await uploadFile(
      'cv',
      pdf(10),
      (next) => states.push(next),
      () => true,
      s as never,
    );
    expect(states).toContainEqual({ phase: 'checking', slow: true });
    expect(states.at(-1)).toEqual({ phase: 'done', fileId: FILE_ID });
  });

  it('gives up as failed only after ten times the usual wait', async () => {
    const s = { ...services(['pending']), maxPolls: 2 };
    s.uploadStatus.mockResolvedValue('pending');
    expect(await run(pdf(10), s)).toEqual({ phase: 'error', message: 'failed' });
    expect(s.uploadStatus).toHaveBeenCalledTimes(20);
  });

  // SAFETY: mutation check: dropped `if (!alive()) return;` from the poll loop -> this test failed (the old upload landed)
  it('Scenario: An old error does not return: once alive turns false, an upload still polling settles nothing', async () => {
    let live = true;
    const s = services(['pending', 'clean']);
    s.uploadStatus.mockImplementation(async () => 'clean');
    const states: DirectUpload[] = [];
    await uploadFile(
      'cv',
      pdf(10),
      (next) => {
        states.push(next);
        if (next.phase === 'checking') live = false;
      },
      () => live,
      s as never,
    );
    expect(states.at(-1)).toEqual({ phase: 'checking' });
  });
});
