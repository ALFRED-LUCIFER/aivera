import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from './route.ts';

// AIV-P0-016: the download route. The files module is replaced; its status and workspace checks are
// tests/integration/src/files.test.ts.
const FILE_ID = '0190d4a2-0000-7000-8000-0000000000f1';
const openDownload = vi.fn();
let configured = true;
vi.mock('@/server/files', () => ({ getFiles: () => (configured ? { files: { openDownload } } : null) }));
vi.mock('@/server/workspace', () => ({
  inActiveWorkspace: async (fn: (ctx: object) => unknown) => ({ value: await fn({}) }),
}));
vi.mock('next/navigation', () => ({ forbidden: () => undefined }));

const get = (id: string) =>
  GET(new Request(`https://credalent.example/api/files/${id}`), { params: Promise.resolve({ id }) });

beforeEach(() => {
  configured = true;
  openDownload.mockReset();
});

describe('GET /api/files/[id]', () => {
  it('Scenario: Files from another workspace cannot be downloaded: a file the module does not return is 404', async () => {
    openDownload.mockResolvedValue(null);
    expect((await get(FILE_ID)).status).toBe(404);
  });

  it('streams a clean file as an attachment the browser will not sniff or render', async () => {
    openDownload.mockResolvedValue({ contentType: 'application/pdf', sizeBytes: 4, body: new Blob(['%PDF']).stream() });
    const response = await get(FILE_ID);
    expect(response.status).toBe(200);
    expect(Object.fromEntries(response.headers)).toMatchObject({
      'content-type': 'application/pdf',
      'content-disposition': 'attachment',
      'x-content-type-options': 'nosniff',
      'cache-control': 'private, no-store',
    });
    expect(await response.text()).toBe('%PDF');
  });

  it('a malformed id, or no storage account, is 404 without asking the module', async () => {
    expect((await get('cv.pdf')).status).toBe(404);
    configured = false;
    expect((await get(FILE_ID)).status).toBe(404);
    expect(openDownload).not.toHaveBeenCalled();
  });
});
