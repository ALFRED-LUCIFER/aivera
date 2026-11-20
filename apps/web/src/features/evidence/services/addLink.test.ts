import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ForbiddenError } from '@credalent/workspaces';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { addLink } from './addLink.ts';

// AIV-P1-076: the action a member adds a link with. The intake module is replaced; its job-scope check is proven against
// PostgreSQL in tests/integration/src/repository-links.test.ts.
const APPLICATION = '0190d4a2-0000-7000-8000-0000000000a1';
const intake = { addLink: vi.fn(async () => ({ sourceId: '0190d4a2-0000-7000-8000-0000000000b1' })) };
vi.mock('@/server/intake', () => ({ getIntake: () => intake }));
vi.mock('@/server/workspace', () => ({
  inActiveWorkspace: async (fn: (ctx: object) => unknown) => {
    try {
      return { value: await fn({}) };
    } catch (error) {
      if (error instanceof ForbiddenError) throw new Error('NEXT_HTTP_ERROR_FALLBACK;403', { cause: error });
      throw error;
    }
  },
}));
vi.mock('next/navigation', () => ({
  forbidden: () => {
    throw new Error('NEXT_HTTP_ERROR_FALLBACK;403');
  },
  unstable_rethrow: (error: unknown) => {
    if (error instanceof Error && error.message.startsWith('NEXT_')) throw error;
  },
}));

const en = JSON.parse(
  readFileSync(
    join(import.meta.dirname, '..', '..', '..', '..', '..', '..', 'packages', 'i18n', 'messages', 'en.json'),
    'utf8',
  ),
) as { evidence: { repositoryStatus: Record<string, string> } };

beforeEach(() => vi.clearAllMocks());

describe('Scenario: A link that is not a GitHub repository is refused and kept as a plain link', () => {
  it.each([
    'https://portfolio.omar.credalent.example/projects',
    'https://gitlab.com/omar-credalent-example/payments',
    'https://github.com/omar-credalent-example',
  ])('%s is kept on the application and AP is told it cannot be read', async (url) => {
    const result = await addLink({ applicationId: APPLICATION, url });
    expect(result).toEqual({ ok: true, read: false, message: 'repositoryStatus.plainLink' });
    expect(intake.addLink).toHaveBeenCalledWith({}, APPLICATION, url);
    expect(en.evidence.repositoryStatus['plainLink']).toBe(
      'Only public GitHub repository links can be read. This link is kept on the candidate as a plain link.',
    );
  });

  it('a GitHub repository link, in any spelling, is kept and read', async () => {
    const url = 'https://github.com/sara-credalent-example/merchant-assistant/?tab=readme';
    expect(await addLink({ applicationId: APPLICATION, url })).toEqual({ ok: true, read: true });
  });
});

describe('Scenario: Only people who can reach the job can add a link', () => {
  it('a refusal from the intake module is the 403 page', async () => {
    intake.addLink.mockRejectedValueOnce(new ForbiddenError());
    await expect(
      addLink({ applicationId: APPLICATION, url: 'https://github.com/sara-credalent-example/merchant-assistant' }),
    ).rejects.toThrow('403');
  });

  it('refuses a malformed request, or one naming a job or a workspace, before calling the module', async () => {
    const url = 'https://github.com/sara-credalent-example/merchant-assistant';
    expect(await addLink({ applicationId: 'not-an-id', url })).toEqual({ ok: false, error: 'failed' });
    expect(await addLink({ applicationId: APPLICATION, url, jobId: APPLICATION })).toEqual({
      ok: false,
      error: 'failed',
    });
    expect(await addLink({ applicationId: APPLICATION, url: 'javascript:alert(1)' })).toEqual({
      ok: false,
      error: 'failed',
    });
    expect(intake.addLink).not.toHaveBeenCalled();
  });
});
