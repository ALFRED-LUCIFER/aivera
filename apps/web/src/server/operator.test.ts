import type { User } from '@aivera/identity';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyStatusChange,
  getWorkspaceFacts,
  isPlatformOperator,
  listOperatorActions,
  listWorkspaceFacts,
  platformOperator,
  setWorkspaceAiBudget,
} from './operator';

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

const warn = vi.hoisted(() => vi.fn());
vi.mock('@aivera/observability', () => ({ log: { warn } }));
// AIV-P2-038: the console's reads and the budget change, behind their contracts.
const DEMO = '0190d4a2-0000-7000-8000-000000000001';
const summary = {
  id: DEMO,
  name: 'Demo Hiring Co',
  type: 'in_house',
  createdAt: new Date('2026-11-19T00:00:00Z'),
  synthetic: true,
  status: 'active',
  activeMembers: 3,
};
const ai = vi.hoisted(() => ({ usage: vi.fn(), setDailyBudget: vi.fn(async (_input: unknown) => undefined) }));
vi.mock('@aivera/workspaces/composition', () => ({
  createWorkspaceDirectory: () => ({
    getSummary: async () => summary,
    listSummaries: async () => ({ total: 1, summaries: [summary] }),
  }),
  createAiBudgetConsole: () => ai,
}));
vi.mock('@aivera/jobs/composition', () => ({ createJobCounts: () => ({ countJobs: async () => 2 }) }));
// The list is parsed on every env() call here, so changing `config.list` is "the app reloads its configuration".
vi.mock('./env', async (actual) => {
  const real = await actual<typeof import('./env')>();
  return { ...real, env: () => ({ platformOperators: real.parseOperatorEmails(config.list) }) };
});
vi.mock('./auth', () => ({ getSessionUserId: () => session(), getIdentity: () => ({ getUser }) }));
vi.mock('./db', () => ({ getDb: () => ({}) }));
const listFor = vi.fn();
vi.mock('@aivera/audit/composition', () => ({ createAudit: () => ({ listFor }) }));
const changeStatus = vi.fn(async (_input: unknown, alongside: (tx: string) => Promise<void>) => alongside('tx'));
const pausePublicListings = vi.fn(async () => {});
vi.mock('./workspace', () => ({ getWorkspaces: () => ({ changeStatus }) }));
vi.mock('./jobs', () => ({ getJobs: () => ({ pausePublicListings }) }));
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

describe('AI token use and the daily budget (AIV-P2-038)', () => {
  const use = { dailyBudget: 2_000_000, overridden: false, days: [{ day: '2026-11-25', tokens: 1_500 }] };
  beforeEach(() => {
    session.mockResolvedValue(PIA);
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-25T09:00:00Z') });
    ai.usage.mockResolvedValue(use);
  });
  afterEach(() => vi.useRealTimers());

  it('the detail reads the 7 UTC days ending today, the list today only', async () => {
    expect(await getWorkspaceFacts(DEMO)).toMatchObject({ jobs: 2, ai: use });
    expect(ai.usage).toHaveBeenCalledWith(DEMO, '2026-11-25', 7);
    await listWorkspaceFacts({ query: '', offset: 0, limit: 50 });
    expect(ai.usage).toHaveBeenLastCalledWith(DEMO, '2026-11-25', 1);
  });

  it('Scenario: Usage not available: a store that cannot be read gives ai null, and the log holds no error text', async () => {
    ai.usage.mockRejectedValue(new Error('relation workspaces.ai_token_usage: Demo Hiring Co'));
    expect(await getWorkspaceFacts(DEMO)).toMatchObject({ name: 'Demo Hiring Co', jobs: 2, ai: null });
    expect(warn).toHaveBeenCalledOnce();
    expect(JSON.stringify(warn.mock.calls)).not.toContain('Demo Hiring Co');
  });

  it('Scenario: Setting an override: the operator is the session user, never the caller', async () => {
    await setWorkspaceAiBudget({ workspaceId: DEMO, dailyBudget: 500_000, reason: 'Pilot cap agreed with the team' });
    expect(ai.setDailyBudget).toHaveBeenCalledExactlyOnceWith({
      operatorId: PIA,
      workspaceId: DEMO,
      dailyBudget: 500_000,
      reason: 'Pilot cap agreed with the team',
    });
  });

  // SAFETY: mutation check: removed `await platformOperator()` from setWorkspaceAiBudget (its userId taken from a stub) -> this test failed (budget set)
  it('Scenario: Non-operators are refused: Alex gets 403 and the budget is unchanged', async () => {
    session.mockResolvedValue(ALEX);
    await expect(setWorkspaceAiBudget({ workspaceId: DEMO, dailyBudget: 500_000, reason: 'x' })).rejects.toThrow(
      'NEXT_HTTP_ERROR_FALLBACK;403',
    );
    expect(ai.setDailyBudget).not.toHaveBeenCalled();
// AIV-P2-037: the status change and its history, as the signed-in operator only. Synthetic ids.
const GULF = '0190d4a2-0000-7000-8000-0000000000b2';

describe('applyStatusChange', () => {
  it("Scenario: A suspension is applied and audited: as her user id, hiding the workspace's public jobs with it", async () => {
    session.mockResolvedValue(PIA);
    await applyStatusChange(GULF, 'suspend', 'Pilot ended on 30 Nov 2026');
    expect(changeStatus).toHaveBeenCalledWith(
      { operatorId: PIA, workspaceId: GULF, change: 'suspend', reason: 'Pilot ended on 30 Nov 2026' },
      expect.any(Function),
    );
    expect(pausePublicListings).toHaveBeenCalledWith('tx', GULF, true);
  });

  it('Scenario: Reactivating shows the public jobs again', async () => {
    session.mockResolvedValue(THEO);
    await applyStatusChange(GULF, 'reactivate', 'Pilot extended to 31 Dec 2026');
    expect(pausePublicListings).toHaveBeenCalledWith('tx', GULF, false);
  });

  // SAFETY: mutation check: removed `await platformOperator()` from applyStatusChange -> this test failed
  it('Scenario: Non-operators cannot suspend: 403 and nothing changes', async () => {
    session.mockResolvedValue(ALEX);
    await expect(applyStatusChange(GULF, 'suspend', 'Pilot ended on 30 Nov 2026')).rejects.toThrow('403');
    expect(changeStatus).not.toHaveBeenCalled();
  });
});

describe('listOperatorActions', () => {
  it("lists only the operator's entries of the workspace's own log, with the reason", async () => {
    session.mockResolvedValue(PIA);
    const at = new Date('2026-11-19T09:00:00Z');
    listFor.mockResolvedValue([
      { action: 'workspace.created', actor: { type: 'user', id: ALEX }, occurredAt: at, note: null },
      { action: 'workspace.suspended', actor: { type: 'operator', id: PIA }, occurredAt: at, note: 'Pilot ended' },
    ]);
    expect(await listOperatorActions(GULF)).toEqual([
      { action: 'workspace.suspended', occurredAt: at, reason: 'Pilot ended' },
    ]);
    expect(listFor).toHaveBeenCalledWith(GULF, { type: 'workspace', id: GULF });
  });

  it('refuses a non-operator before reading anything', async () => {
    session.mockResolvedValue(ALEX);
    await expect(listOperatorActions(GULF)).rejects.toThrow('403');
    expect(listFor).not.toHaveBeenCalled();
  });
});
