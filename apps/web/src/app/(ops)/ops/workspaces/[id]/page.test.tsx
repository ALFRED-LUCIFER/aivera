import { beforeEach, describe, expect, it, vi } from 'vitest';
import WorkspacePage from './page.tsx';

// AIV-P2-036 (ADR-012 point 8): opening a workspace is recorded on the server before the page renders. Synthetic ids.
const PIA = '0190d4a2-0000-7000-8000-00000000a001';
const GULF = '0190d4a2-0000-7000-8000-0000000000b2';
const operator = vi.fn<() => Promise<{ userId: string }>>();
const getWorkspaceFacts = vi.fn(async (id: string) =>
  id === GULF ? { id: GULF, name: 'Gulf Talent Partners' } : null,
);
const recordPlatform = vi.fn(async (_entry: unknown) => undefined);

vi.mock('@/server/operator', () => ({
  platformOperator: () => operator(),
  getWorkspaceFacts: (id: string) => getWorkspaceFacts(id),
  getAudit: () => ({ recordPlatform }),
  listOperatorActions: async () => [],
}));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_HTTP_ERROR_FALLBACK;404');
  },
}));

const open = (id: string) => WorkspacePage({ params: Promise.resolve({ id }) } as PageProps<'/ops/workspaces/[id]'>);

beforeEach(() => {
  vi.clearAllMocks();
  operator.mockResolvedValue({ userId: PIA });
});

describe('the workspace detail page (server)', () => {
  // SAFETY: mutation check: removed the recordPlatform call from the detail page -> this test failed
  it('Scenario: Opening a workspace: writes "ops.workspace_viewed" with her user id and the workspace id', async () => {
    await open(GULF);
    expect(recordPlatform).toHaveBeenCalledExactlyOnceWith({
      actorId: PIA,
      action: 'ops.workspace_viewed',
      subject: { type: 'workspace', id: GULF },
    });
  });

  it.each([
    ['an id that is not a uuid', 'gulf'],
    ['an unknown workspace', '0190d4a2-0000-7000-8000-0000000000ff'],
  ])('%s is a 404 and records nothing', async (_, id) => {
    await expect(open(id)).rejects.toThrow('NEXT_HTTP_ERROR_FALLBACK;404');
    expect(recordPlatform).not.toHaveBeenCalled();
  });

  // SAFETY: mutation check: removed `await platformOperator()` from the detail page -> this test failed (facts read)
  it('Scenario: Non-operators are refused: a 403 before any workspace is read or recorded', async () => {
    operator.mockRejectedValue(new Error('NEXT_HTTP_ERROR_FALLBACK;403'));
    await expect(open(GULF)).rejects.toThrow('NEXT_HTTP_ERROR_FALLBACK;403');
    expect(getWorkspaceFacts).not.toHaveBeenCalled();
    expect(recordPlatform).not.toHaveBeenCalled();
  });
});
