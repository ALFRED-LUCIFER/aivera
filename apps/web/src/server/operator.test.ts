import type { User } from '@credalent/identity';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyStatusChange,
  dashboardReads,
  getCatalogueVersion,
  getWorkspaceFacts,
  listCatalogueVersions,
  isPlatformOperator,
  listOperatorActions,
  listPlatformAudit,
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
vi.mock('@credalent/observability', () => ({ log: { warn } }));
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
const listStatuses = vi.hoisted(() => vi.fn());
const listSummaries = vi.hoisted(() => vi.fn(async (_search: unknown) => ({ total: 1, summaries: [summary] })));
// The dashboard's reads (AIV-P2-051) and the catalogue history's (AIV-P2-050).
const catalogue = vi.hoisted(() => ({
  getEditor: vi.fn(),
  getDraftEval: vi.fn(),
  listVersions: vi.fn(),
  getVersion: vi.fn(),
}));
vi.mock('@credalent/workspaces/composition', () => ({
  createWorkspaceDirectory: () => ({
    getSummary: async () => summary,
    listSummaries: (search: unknown) => listSummaries(search),
    listStatuses: () => listStatuses(),
  }),
  createAiBudgetConsole: () => ai,
}));
vi.mock('@credalent/jobs/composition', () => ({
  createJobCounts: () => ({ countJobs: async () => 2 }),
  createCatalogueEditor: () => catalogue,
}));
// The list is parsed on every env() call here, so changing `config.list` is "the app reloads its configuration".
vi.mock('./env', async (actual) => {
  const real = await actual<typeof import('./env')>();
  return { ...real, env: () => ({ platformOperators: real.parseOperatorEmails(config.list) }) };
});
vi.mock('./auth', () => ({ getSessionUserId: () => session(), getIdentity: () => ({ getUser }) }));
vi.mock('./db', () => ({ getDb: () => ({}) }));
const listOperatorEntries = vi.fn();
const listPlatformEntries = vi.fn();
vi.mock('@credalent/audit/composition', () => ({ createAudit: () => ({ listOperatorEntries, listPlatformEntries }) }));
const changeStatus = vi.fn(async (_input: unknown, alongside: (tx: string) => Promise<void>) => alongside('tx'));
const pausePublicListings = vi.fn(async () => {});
vi.mock('./workspace', () => ({ getWorkspaces: () => ({ changeStatus }) }));
vi.mock('./jobs', () => ({
  getJobs: () => ({ pausePublicListings }),
}));
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
    await expect(platformOperator()).resolves.toMatchObject({ userId: PIA });
  });

  it('Scenario: Email matching ignores case: Theo is listed as "Theo.Platform@example.com"', async () => {
    session.mockResolvedValue(THEO);
    await expect(platformOperator()).resolves.toMatchObject({ userId: THEO });
  });

  it('Scenario: Not signed in: sends to sign-in and back to /ops', async () => {
    session.mockResolvedValue(null);
    await expect(platformOperator()).rejects.toThrow('NEXT_REDIRECT;/sign-in?next=%2Fops');
  });

  // SAFETY: mutation check: removed `if (!user) forbidden()` from platformOperator -> this test failed
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
    await expect(platformOperator()).resolves.toMatchObject({ userId: PIA });
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
  });
});

// AIV-P2-051: the console home's reads, each failing on its own, ids and numbers only.
describe('dashboardReads (AIV-P2-051)', () => {
  const use = { dailyBudget: 2_000_000, overridden: false, days: [{ day: '2026-11-25', tokens: 1_500 }] };
  const statuses = [{ id: DEMO, status: 'active', createdAt: new Date('2026-11-19T00:00:00Z') }];
  const EDITED = new Date('2026-11-25T07:00:00Z');
  const live = { version: 1, draft: { editedAt: EDITED, eval: 'not_run' } };
  beforeEach(() => {
    session.mockResolvedValue(PIA);
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-25T09:00:00Z') });
    listStatuses.mockResolvedValue(statuses);
    ai.usage.mockResolvedValue(use);
    catalogue.getEditor.mockResolvedValue({ published: { version: 1 }, draft: { revisedAt: EDITED } });
    catalogue.getDraftEval.mockResolvedValue({ status: 'not_run' });
  });
  afterEach(() => vi.useRealTimers());

  it("reads each workspace's status and today's UTC tokens, and the catalogue version", async () => {
    expect(await dashboardReads()).toEqual({ workspaces: statuses, ai: [use], catalogue: live });
    expect(ai.usage).toHaveBeenCalledExactlyOnceWith(DEMO, '2026-11-25', 1);
  });

  // SAFETY: mutation check: dropped the `.catch(failed('ai'))` on the AI read -> this test failed (rejected)
  it('Scenario: A read fails: the AI read failing leaves the other tiles, and the log holds no error text', async () => {
    ai.usage.mockRejectedValue(new Error('relation workspaces.ai_token_usage: Demo Hiring Co'));
    expect(await dashboardReads()).toEqual({ workspaces: statuses, ai: null, catalogue: live });
    expect(JSON.stringify(warn.mock.calls)).not.toContain('Demo Hiring Co');
  });

  it('the catalogue read failing leaves the workspace and AI tiles', async () => {
    catalogue.getDraftEval.mockRejectedValue(new Error('down'));
    expect(await dashboardReads()).toEqual({ workspaces: statuses, ai: [use], catalogue: null });
  });

  it('no open draft: the version alone', async () => {
    catalogue.getEditor.mockResolvedValue({ published: { version: 3 }, draft: null });
    catalogue.getDraftEval.mockResolvedValue(null);
    expect((await dashboardReads()).catalogue).toEqual({ version: 3, draft: null });
  });

  // SAFETY: mutation check: removed `await platformOperator()` from dashboardReads -> this test failed (statuses read)
  it('Scenario: Only operators see the dashboard: Riya gets 403 and nothing is read', async () => {
    session.mockResolvedValue(ALEX);
    await expect(dashboardReads()).rejects.toThrow('NEXT_HTTP_ERROR_FALLBACK;403');
    expect(listStatuses).not.toHaveBeenCalled();
  });
});

describe('listWorkspaceFacts sorted by AI (AIV-P2-051)', () => {
  beforeEach(() => session.mockResolvedValue(PIA));

  it("reads every match, then pages the rows by today's tokens, most first, unreadable usage last", async () => {
    const tokens: Record<string, number | null> = { a: 10, b: null, c: 900, d: 0 };
    listSummaries.mockResolvedValueOnce({ total: 4, summaries: Object.keys(tokens).map((id) => ({ ...summary, id })) });
    ai.usage.mockImplementation(async (id: string) => {
      const used = tokens[id];
      if (used === null || used === undefined) throw new Error('unreadable');
      return { dailyBudget: 1000, overridden: false, days: [{ day: '2026-11-25', tokens: used }] };
    });
    const { total, rows } = await listWorkspaceFacts({ query: '', offset: 1, limit: 2, status: 'active' }, 'ai');
    expect([total, rows.map((r) => r.id)]).toEqual([4, ['a', 'd']]);
    expect(listSummaries).toHaveBeenCalledWith({
      query: '',
      offset: 0,
      limit: Number.MAX_SAFE_INTEGER,
      status: 'active',
    });
  });
});

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
  it("lists the operators' status changes from the workspace's own log, with the reason", async () => {
    session.mockResolvedValue(PIA);
    const at = new Date('2026-11-19T09:00:00Z');
    listOperatorEntries.mockResolvedValue([
      { action: 'workspace.suspended', actor: { type: 'operator', id: PIA }, occurredAt: at, note: 'Pilot ended' },
    ]);
    expect(await listOperatorActions(GULF)).toEqual([
      { action: 'workspace.suspended', occurredAt: at, reason: 'Pilot ended' },
    ]);
    expect(listOperatorEntries).toHaveBeenCalledWith(GULF);
  });

  it('refuses a non-operator before reading anything', async () => {
    session.mockResolvedValue(ALEX);
    await expect(listOperatorActions(GULF)).rejects.toThrow('403');
    expect(listOperatorEntries).not.toHaveBeenCalled();
  });
});

// AIV-P2-054: the platform audit log page's read.
const NAMELESS = '0190d4a2-0000-7000-8000-00000000a004';
const entry = (id: string, actorId: string) => ({
  id,
  occurredAt: new Date('2026-11-20T09:30:00Z'),
  actorId,
  action: 'workspace.suspended',
  subject: { type: 'workspace', id: GULF },
  note: 'Pilot ended on 30 Nov 2026',
  before: { status: 'active' },
  after: { status: 'suspended' },
});

describe('listPlatformAudit (AIV-P2-054)', () => {
  it('names each operator by display name only, never an email, and lists the operators in the log for the filter', async () => {
    session.mockResolvedValue(THEO);
    const filtered = { entries: [entry('0190d4a2-0000-7000-8000-0000000000e1', PIA)], nextCursor: null };
    listPlatformEntries.mockImplementation(async (query: { actorId?: string }) =>
      query.actorId ? filtered : { entries: [entry('e2', THEO), entry('e3', NAMELESS)], nextCursor: null },
    );
    getUser.mockImplementation(async (id: string) =>
      id === NAMELESS
        ? { id, email: 'nameless@example.com', displayName: null, createdAt: new Date('2026-11-19T00:00:00Z') }
        : (users[id] ?? null),
    );
    const result = await listPlatformAudit({ actorId: PIA });
    expect(listPlatformEntries).toHaveBeenCalledWith({ actorId: PIA });
    expect(result.rows).toEqual([{ ...filtered.entries[0], operatorName: 'Pia Platform' }]);
    expect(result.nextCursor).toBeNull();
    // Sorted by name; the operator with no display name is not offered (an id is not a name), and no email anywhere.
    expect(result.operators).toEqual([
      { id: PIA, name: 'Pia Platform' },
      { id: THEO, name: 'Theo Platform' },
    ]);
    expect(JSON.stringify(result)).not.toContain('@example.com');
  });

  it('scans at most 10 pages of the log for the operator filter', async () => {
    session.mockResolvedValue(THEO);
    listPlatformEntries.mockResolvedValue({ entries: [entry('e1', PIA)], nextCursor: 'more' });
    await listPlatformAudit({});
    // One read for the page, ten for the filter's operators.
    expect(listPlatformEntries).toHaveBeenCalledTimes(11);
  });

  // SAFETY: mutation check: removed `await platformOperator()` from listPlatformAudit -> this test failed (resolved)
  it('refuses a non-operator before reading anything', async () => {
    session.mockResolvedValue(ALEX);
    await expect(listPlatformAudit({})).rejects.toThrow('403');
    expect(listPlatformEntries).not.toHaveBeenCalled();
  });
});

describe('the signed-in operator for the shell (AIV-P2-052)', () => {
  it('returns their own name and email from the same identity read as the check', async () => {
    config.list = 'theo.platform@example.com';
    session.mockResolvedValue(THEO);
    await expect(platformOperator()).resolves.toEqual({
      userId: THEO,
      name: 'Theo Platform',
      email: 'theo.platform@example.com',
    });
    expect(getUser).toHaveBeenCalledOnce();
  });

  it('with no display name, the email is the name', async () => {
    config.list = 'pia.platform@example.com';
    session.mockResolvedValue(PIA);
    getUser.mockResolvedValueOnce({ ...(users[PIA] as User), displayName: null });
    await expect(platformOperator()).resolves.toMatchObject({ name: 'pia.platform@example.com' });
  });
});

const versionRow = (version: number, publishedBy: string) => ({
  version,
  publishedAt: new Date('2026-11-21T09:00:00Z'),
  publishedBy,
  reason: 'Add insurance pack for the pilot client',
  counts: null,
  evalStatus: null,
});

describe('the catalogue version history (AIV-P2-050)', () => {
  it('names each publisher by display name, the seed as none, and an unknown id as none', async () => {
    session.mockResolvedValue(THEO);
    const UNKNOWN = '0190d4a2-0000-7000-8000-00000000a0ff';
    catalogue.listVersions.mockResolvedValue({
      total: 3,
      rows: [versionRow(3, UNKNOWN), versionRow(2, PIA), versionRow(1, 'system:seed')],
    });
    const result = await listCatalogueVersions(1);
    expect(catalogue.listVersions).toHaveBeenCalledWith(1);
    expect(result.rows.map((r) => r.publisherName)).toEqual([null, 'Pia Platform', null]);
    // The seed is never looked up as a user.
    expect(getUser).not.toHaveBeenCalledWith('system:seed');
  });

  it('a missing version is null', async () => {
    session.mockResolvedValue(THEO);
    catalogue.getVersion.mockResolvedValue(null);
    expect(await getCatalogueVersion(99)).toBeNull();
  });

  // SAFETY: mutation check: removed `await platformOperator()` from listCatalogueVersions and getCatalogueVersion -> this test failed (resolved)
  it('Scenario: Only operators can read the history: Riya gets 403 before anything is read', async () => {
    session.mockResolvedValue(ALEX);
    await expect(listCatalogueVersions(1)).rejects.toThrow('403');
    await expect(getCatalogueVersion(2)).rejects.toThrow('403');
    expect(catalogue.listVersions).not.toHaveBeenCalled();
    expect(catalogue.getVersion).not.toHaveBeenCalled();
  });
});
