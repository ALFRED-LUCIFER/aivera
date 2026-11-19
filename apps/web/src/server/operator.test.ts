import type { User } from '@aivera/identity';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isPlatformOperator, platformOperator } from './operator';

// AIV-P2-035 (ADR-012): the platformOperator policy. Synthetic operators from docs/00-product/personas.md.
const PIA = '0190d4a2-0000-7000-8000-00000000a001';
const THEO = '0190d4a2-0000-7000-8000-00000000a002';
const ALEX = '0190d4a2-0000-7000-8000-00000000a003';
const users: Record<string, User> = {
  [PIA]: {
    id: PIA,
    email: 'pia.platform@example.com',
    displayName: 'Pia Platform',
    createdAt: new Date('2026-11-19T00:00:00Z'),
  },
  [THEO]: {
    id: THEO,
    email: 'theo.platform@example.com',
    displayName: 'Theo Platform',
    createdAt: new Date('2026-11-19T00:00:00Z'),
  },
  [ALEX]: {
    id: ALEX,
    email: 'alex@example.com',
    displayName: 'Alex Recruiter',
    createdAt: new Date('2026-11-19T00:00:00Z'),
  },
};

const config = vi.hoisted(() => ({ list: undefined as string | undefined }));
const session = vi.fn<() => Promise<string | null>>();
const getUser = vi.fn(async (id: string) => users[id] ?? null);

vi.mock('@aivera/observability', () => ({ log: { warn: vi.fn() } }));
// The list is parsed on every env() call here, so changing `config.list` is "the app reloads its configuration".
vi.mock('./env', async (actual) => {
  const real = await actual<typeof import('./env')>();
  return { ...real, env: () => ({ platformOperators: real.parseOperatorEmails(config.list) }) };
});
vi.mock('./auth', () => ({ getSessionUserId: () => session(), getIdentity: () => ({ getUser }) }));
vi.mock('./db', () => ({ getDb: () => ({}) }));
vi.mock('@aivera/audit/composition', () => ({ createAudit: () => ({}) }));
vi.mock('next/navigation', () => ({
  forbidden: () => {
    throw new Error('NEXT_HTTP_ERROR_FALLBACK;403');
  },
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT;${to}`);
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  config.list = 'pia.platform@example.com,Theo.Platform@example.com';
});

describe('platformOperator', () => {
  it('Scenario: An operator opens the console: lets Pia in with her user id', async () => {
    session.mockResolvedValue(PIA);
    await expect(platformOperator()).resolves.toEqual({ userId: PIA });
  });

  it('Scenario: Email matching ignores case: Theo is listed as "Theo.Platform@example.com"', async () => {
    session.mockResolvedValue(THEO);
    await expect(platformOperator()).resolves.toEqual({ userId: THEO });
  });

  it('Scenario: Not signed in: sends to sign-in and back to /ops', async () => {
    session.mockResolvedValue(null);
    await expect(platformOperator()).rejects.toThrow('NEXT_REDIRECT;/sign-in?next=%2Fops');
  });

  // SAFETY: mutation check: removed `if (!(await isPlatformOperator(userId))) forbidden()` -> this test failed (resolved)
  it('Scenario Outline: Everyone else is refused on the server: a signed-in non-operator gets 403', async () => {
    session.mockResolvedValue(ALEX);
    await expect(platformOperator()).rejects.toThrow('NEXT_HTTP_ERROR_FALLBACK;403');
  });

  it('a session whose identity user no longer exists gets 403', async () => {
    session.mockResolvedValue('0190d4a2-0000-7000-8000-00000000a0ff');
    await expect(platformOperator()).rejects.toThrow('NEXT_HTTP_ERROR_FALLBACK;403');
  });

  it('Scenario: Removing an operator takes effect on the next request', async () => {
    session.mockResolvedValue(PIA);
    await expect(platformOperator()).resolves.toEqual({ userId: PIA });
    config.list = 'theo.platform@example.com';
    await expect(platformOperator()).rejects.toThrow('NEXT_HTTP_ERROR_FALLBACK;403');
  });
});

describe('isPlatformOperator', () => {
  // SAFETY: mutation check: made an empty list return true in isPlatformOperator -> these three cases failed
  it.each([
    ['unset', undefined],
    ['empty', ''],
    ['malformed', 'not-an-email,,'],
  ])('Scenario Outline: The console fails closed without a valid operator list (%s)', async (_case, list) => {
    config.list = list;
    expect(await isPlatformOperator(PIA)).toBe(false);
    expect(getUser).not.toHaveBeenCalled();
  });

  it("reads the identity user's stored email on every call, never a cached answer", async () => {
    expect(await isPlatformOperator(PIA)).toBe(true);
    expect(await isPlatformOperator(PIA)).toBe(true);
    expect(getUser).toHaveBeenCalledTimes(2);
  });
});
