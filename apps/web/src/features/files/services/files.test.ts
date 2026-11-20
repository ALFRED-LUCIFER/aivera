import { FileError, type FileStatus } from '@credalent/files';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { completeUpload, requestUpload } from './files.ts';

// AIV-P0-016: the upload actions. The files module is replaced.
const FILE_ID = '0190d4a2-0000-7000-8000-0000000000f1';
const files = {
  requestUpload: vi.fn(async () => ({ fileId: FILE_ID, uploadUrl: 'https://st.example/sas', expiresAt: new Date() })),
  getStatus: vi.fn(async (): Promise<FileStatus | null> => 'pending'),
  markCleanWithoutScan: vi.fn(async (): Promise<FileStatus> => 'clean'),
};
let malwareScanning = true;
vi.mock('@/server/files', () => ({ getFiles: () => ({ files, malwareScanning }) }));
vi.mock('@/server/workspace', () => ({
  inActiveWorkspace: async (fn: (ctx: object) => unknown) => ({ value: await fn({}) }),
}));
vi.mock('next/navigation', () => ({
  forbidden: () => {
    throw new Error('NEXT_HTTP_ERROR_FALLBACK;403');
  },
  unstable_rethrow: () => undefined,
}));

const pdf = { purpose: 'portal', fileName: 'eval-set-sample.pdf', contentType: 'application/pdf', size: 2048 };

beforeEach(() => {
  malwareScanning = true;
  vi.clearAllMocks();
});

describe('upload actions', () => {
  it('returns the SAS URL, or the limit message the module refused with', async () => {
    expect(await requestUpload(pdf)).toEqual({ ok: true, fileId: FILE_ID, uploadUrl: 'https://st.example/sas' });
    files.requestUpload.mockRejectedValueOnce(new FileError('limits.evidence'));
    expect(await requestUpload(pdf)).toEqual({ ok: false, error: 'limits.evidence' });
  });

  it('refuses a malformed request, or one naming a workspace, before calling the module', async () => {
    expect(await requestUpload({ ...pdf, size: -1 })).toEqual({ ok: false, error: 'failed' });
    expect(await requestUpload({ ...pdf, workspaceId: FILE_ID })).toEqual({ ok: false, error: 'failed' });
    expect(files.requestUpload).not.toHaveBeenCalled();
  });

  it('with scanning on, completing an upload only reads its status; off, it settles it without a scan', async () => {
    expect(await completeUpload(FILE_ID)).toBe('pending');
    expect(files.markCleanWithoutScan).not.toHaveBeenCalled();
    malwareScanning = false;
    expect(await completeUpload(FILE_ID)).toBe('clean');
    expect(files.markCleanWithoutScan).toHaveBeenCalledTimes(1);
  });
});
