import type { AiTokenUse, WorkspaceStatus } from '@credalent/workspaces';
import { describe, expect, it } from 'vitest';
import { dashboardView, statusHref } from './dashboard.ts';

// AIV-P2-051: the console home's tiles from per-workspace ids and numbers. Synthetic ids only.
const NOW = new Date('2026-11-25T09:00:00Z');
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000);
let n = 0;
const ws = (status: WorkspaceStatus, createdAt = daysAgo(10)) => ({ id: `w${++n}`, status, createdAt });
const use = (tokens: number, dailyBudget = 1_000_000): AiTokenUse => ({
  dailyBudget,
  overridden: false,
  days: [{ day: '2026-11-25', tokens }],
});
const reads = { workspaces: [], ai: [], catalogueVersion: 1 };

describe('Scenario: The dashboard shows observed counts with links', () => {
  it('counts every status, and the oldest waiting workspace in whole days', () => {
    const view = dashboardView(
      {
        ...reads,
        workspaces: [
          ...Array.from({ length: 4 }, () => ws('active')),
          ws('pending_approval', daysAgo(1)),
          ws('pending_approval', daysAgo(3.5)),
          ws('suspended'),
        ],
      },
      NOW,
    );
    expect(view.statuses).toEqual([
      { status: 'active', count: 4 },
      { status: 'pending_approval', count: 2 },
      { status: 'suspended', count: 1 },
      { status: 'rejected', count: 0 },
    ]);
    expect(view.oldestWaitingDays).toBe(3);
  });

  it('waiting links to the approvals page, the other statuses to the filtered list', () => {
    expect(statusHref('pending_approval')).toBe('/ops/approvals');
    expect(statusHref('suspended')).toBe('/ops/workspaces?status=suspended');
  });
});

describe('Scenario: AI tokens today against budgets', () => {
  // SAFETY: mutation check: counted `share >= 0.8` without `< 1` for nearBudget -> this test failed (2 near)
  it('totals today; 82% is near the budget, 100% and over are at it, 79% is neither', () => {
    const view = dashboardView({ ...reads, ai: [use(820_000), use(1_000_000), use(790_000), use(5, 4), null] }, NOW);
    expect(view.ai).toEqual({ tokens: 2_610_005, nearBudget: 1, atBudget: 2 });
  });

  it('reads a workspace override as its budget', () => {
    expect(dashboardView({ ...reads, ai: [use(400_000, 500_000)] }, NOW).ai).toMatchObject({ nearBudget: 1 });
  });
});

describe('Scenario: Nothing to show yet', () => {
  it('no workspace: every status is 0, none waits, and AI is "Not yet available", never 0', () => {
    const view = dashboardView(reads, NOW);
    expect(view.statuses?.map((s) => s.count)).toEqual([0, 0, 0, 0]);
    expect(view.oldestWaitingDays).toBeNull();
    expect(view.ai).toEqual({ tokens: null, nearBudget: 0, atBudget: 0 });
  });

  it('workspaces with no AI call today: still "Not yet available"', () => {
    expect(dashboardView({ ...reads, ai: [use(0), use(0)] }, NOW).ai?.tokens).toBeNull();
  });
});

describe('Scenario: A read fails', () => {
  // SAFETY: mutation check: made a null `ai` read give `{ tokens: null, ... }` -> this test failed
  it('each failed read empties only its own tile', () => {
    const view = dashboardView({ workspaces: [ws('active')], ai: null, catalogueVersion: 1 }, NOW);
    expect(view.ai).toBeNull();
    expect(view.statuses?.[0]).toEqual({ status: 'active', count: 1 });
    expect(view.catalogue).toEqual({ version: 1 });
    const other = dashboardView({ workspaces: null, ai: [use(10)], catalogueVersion: null }, NOW);
    expect([other.statuses, other.oldestWaitingDays, other.catalogue]).toEqual([null, null, null]);
    expect(other.ai?.tokens).toBe(10);
  });
});
