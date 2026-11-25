import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from './route.ts';

// AIV-P1-045: the route a source chip opens. The files module is replaced; who may get a link, the 5 minutes and the
// audit entry are modules/files/src/application/files.test.ts and tests/integration/src/files.test.ts.
const FILE_ID = '0190d4a2-0000-7000-8000-0000000000f1';
const LINK = `https://blob.credalent.example/evidence/w/1/${FILE_ID}?sig=test`;
const issueReadLink = vi.fn();
let configured = true;
let member = true;
vi.mock('@/server/files', () => ({ getFiles: () => (configured ? { files: { issueReadLink } } : null) }));
vi.mock('@/server/workspace', () => ({
  inActiveWorkspace: async (fn: (ctx: object) => unknown) => (member ? { value: await fn({}) } : null),
}));
class Forbidden extends Error {}
vi.mock('next/navigation', () => ({
  forbidden: () => {
    throw new Forbidden();
  },
}));

const get = (id: string) =>
  GET(new Request(`https://credalent.example/api/files/${id}/link`), { params: Promise.resolve({ id }) });

beforeEach(() => {
  configured = true;
  member = true;
  issueReadLink.mockReset();
});

describe('GET /api/files/[id]/link', () => {
  it('Scenario: Opening an uploaded file: redirects to the 5-minute link, which is never cached or sent as a referrer', async () => {
    issueReadLink.mockResolvedValue({ url: LINK, expiresAt: new Date('2026-11-20T09:05:00Z') });
    const response = await get(FILE_ID);
    expect(response.status).toBe(302);
    expect(Object.fromEntries(response.headers)).toMatchObject({
      location: LINK,
      'cache-control': 'private, no-store',
      'referrer-policy': 'no-referrer',
    });
    expect(issueReadLink).toHaveBeenCalledWith({}, FILE_ID);
  });

  it('a file the module gives no link for (another workspace, missing, not clean) is 404', async () => {
    issueReadLink.mockResolvedValue(null);
    const response = await get(FILE_ID);
    expect([response.status, response.headers.get('location')]).toEqual([404, null]);
  });

  it('with no active workspace the answer is the 403 page, never a link', async () => {
    member = false;
    await expect(get(FILE_ID)).rejects.toBeInstanceOf(Forbidden);
    expect(issueReadLink).not.toHaveBeenCalled();
  });

  it('a malformed id, or no storage account, is 404 without asking the module', async () => {
    expect((await get('cv.pdf')).status).toBe(404);
    configured = false;
    expect((await get(FILE_ID)).status).toBe(404);
    expect(issueReadLink).not.toHaveBeenCalled();
  });
});
