import type { Tx } from '@credalent/db/client';
import type { WorkspaceContext } from '@credalent/workspaces';
import { describe, expect, it, vi } from 'vitest';
import { FileError, type FileStatus } from '../domain/files.ts';
import { filesUseCases, type BlobStore, type FileRecord } from './files.ts';

// The use cases over in-memory ports; the database and Azurite scenarios are tests/integration/src/files.test.ts.
const W = '0190d4a2-0000-7000-8000-0000000000a1';
const F = '0190d4a2-0000-7000-8000-0000000000f1';
const USER = '0190d4a2-0000-7000-8000-00000000a1e1';
const ctx = { userId: USER, workspaceId: W, role: 'recruiter', status: 'active', tx: {} } as WorkspaceContext;
const pending = (): FileRecord => ({
  id: F,
  workspaceId: W,
  candidateAccountId: null,
  purpose: 'portal',
  contentType: 'application/pdf',
  sizeBytes: 4,
  sha256: null,
  status: 'pending',
  blobPath: `uploads-quarantine/w/${W}/${F}`,
  uploadedBy: USER,
  createdAt: new Date('2026-11-20T09:00:00Z'),
});

type Stored = { data: Buffer; contentType: string } | null;

function setup(malwareScanning: boolean, uploaded: Stored, moved: Stored = null) {
  let row = pending();
  const blobs = {
    uploadUrl: vi.fn(),
    read: vi.fn(async (path: string, maxBytes: number) => {
      const blob = path.startsWith('uploads-quarantine/') ? uploaded : moved;
      return (
        blob && {
          size: blob.data.length,
          contentType: blob.contentType,
          data: blob.data.length <= maxBytes ? blob.data : null,
        }
      );
    }),
    write: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
    stream: vi.fn(async () => new ReadableStream<Uint8Array>()),
  } satisfies BlobStore;
  const store = {
    insert: vi.fn(),
    find: vi.fn(async () => row),
    settle: vi.fn(async (_id: string, change: Partial<FileRecord>) => void (row = { ...row, ...change })),
  };
  const published: FileStatus[] = [];
  const useCases = filesUseCases({
    storeFor: () => store,
    blobs,
    inScope: (_owner, work) => work({} as Tx),
    publishSettled: async (_tx, _file, status) => void published.push(status),
    authorize: async () => undefined,
    malwareScanning,
    newId: () => F,
    now: () => new Date('2026-11-20T09:00:00Z'),
  });
  return { useCases, blobs, store, published, row: () => row };
}

const pdf = { data: Buffer.from('%PDF'), contentType: 'application/pdf' };

describe('Scenario: the scan-off path is refused when scanning is on', () => {
  // SAFETY: mutation check: removed `if (p.malwareScanning) throw` from markCleanWithoutScan -> this test failed (resolved 'clean')
  it('with MALWARE_SCANNING on, marking an upload clean without a scan throws and reads nothing', async () => {
    const { useCases, blobs, store, row } = setup(true, pdf);
    await expect(useCases.markCleanWithoutScan(ctx, F)).rejects.toEqual(new FileError('scanning_required'));
    expect(store.find).not.toHaveBeenCalled();
    expect(blobs.read).not.toHaveBeenCalled();
    expect(row().status).toBe('pending');
  });

  it('with it off, the upload is moved to its final container and marked clean', async () => {
    const { useCases, blobs, published, row } = setup(false, pdf);
    expect(await useCases.markCleanWithoutScan(ctx, F)).toBe('clean');
    expect(blobs.write).toHaveBeenCalledWith(`evidence/w/${W}/${F}`, pdf.data, 'application/pdf');
    expect(blobs.delete).toHaveBeenCalledWith(`uploads-quarantine/w/${W}/${F}`);
    expect(row()).toMatchObject({ status: 'clean', blobPath: `evidence/w/${W}/${F}`, sha256: expect.any(String) });
    expect(published).toEqual(['clean']);
  });
});

describe('the server-side re-check of what was uploaded', () => {
  it.each([
    ['a bigger blob than declared', { ...pdf, data: Buffer.from('%PDF-1.7') }],
    ['another content type than declared', { ...pdf, contentType: 'text/html' }],
    ['no blob at all', null],
  ])('%s is deleted and rejected, never moved', async (_label, uploaded) => {
    const { useCases, blobs, published, row } = setup(false, uploaded);
    expect(await useCases.markCleanWithoutScan(ctx, F)).toBe('rejected');
    expect(blobs.write).not.toHaveBeenCalled();
    expect(blobs.delete).toHaveBeenCalledWith(`uploads-quarantine/w/${W}/${F}`);
    expect([row().status, published]).toEqual(['rejected', ['rejected']]);
  });

  // The retry after a commit that failed once quarantine was emptied: the moved copy is settled, never rejected.
  it('with quarantine already emptied, the copy in the final container is settled clean', async () => {
    const { useCases, row } = setup(false, null, pdf);
    expect(await useCases.markCleanWithoutScan(ctx, F)).toBe('clean');
    expect(row().status).toBe('clean');
  });

  it("another member's upload is not found", async () => {
    const { useCases } = setup(false, pdf);
    await expect(useCases.markCleanWithoutScan({ ...ctx, userId: W }, F)).rejects.toEqual(new FileError('not_found'));
  });

  it('a settled file is left as it is, so a redelivered scan result changes nothing', async () => {
    const { useCases, blobs } = setup(false, pdf);
    await useCases.applyScanResult({ owner: { workspaceId: W }, fileId: F }, 'clean');
    expect(await useCases.applyScanResult({ owner: { workspaceId: W }, fileId: F }, 'infected')).toBe('clean');
    expect(blobs.delete).toHaveBeenCalledTimes(1);
  });
});
