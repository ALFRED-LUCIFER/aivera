import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CONSOLE_OPENED_COOKIE } from '../domain/ops.ts';
import { openConsole } from './openConsole.ts';

// AIV-P2-035: the console's one server action, called directly. Synthetic opaque ids.
const PIA = '0190d4a2-0000-7000-8000-00000000a001';
const operator = vi.fn<() => Promise<{ userId: string }>>();
const recordPlatform = vi.fn(async () => undefined);
const jar = new Map<string, string>();

vi.mock('@/server/operator', () => ({ platformOperator: () => operator(), getAudit: () => ({ recordPlatform }) }));
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name) } : undefined),
    set: ({ name, value }: { name: string; value: string }) => jar.set(name, value),
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  jar.clear();
  operator.mockResolvedValue({ userId: PIA });
});

describe('openConsole (server action)', () => {
  it('Scenario: An operator opens the console: one "ops.console_opened" entry per session, with her user id', async () => {
    await openConsole();
    await openConsole();
    expect(recordPlatform).toHaveBeenCalledOnce();
    expect(recordPlatform).toHaveBeenCalledWith({ actorId: PIA, action: 'ops.console_opened' });
    expect(jar.get(CONSOLE_OPENED_COOKIE)).toBe(PIA);
  });

  it("another operator's marker in the same browser does not count for her", async () => {
    jar.set(CONSOLE_OPENED_COOKIE, '0190d4a2-0000-7000-8000-00000000a002');
    await openConsole();
    expect(recordPlatform).toHaveBeenCalledOnce();
  });

  // SAFETY: mutation check: replaced `await platformOperator()` in openConsole with an actor read from the cookie -> this test failed (entry written)
  it('Scenario Outline: Everyone else is refused on the server: a direct call by a non-operator is a 403 and writes nothing', async () => {
    operator.mockRejectedValue(new Error('NEXT_HTTP_ERROR_FALLBACK;403'));
    await expect(openConsole()).rejects.toThrow('NEXT_HTTP_ERROR_FALLBACK;403');
    expect(recordPlatform).not.toHaveBeenCalled();
    expect(jar.size).toBe(0);
  });
});
