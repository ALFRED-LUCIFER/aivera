// The console home's stat tiles (AIV-P2-051, ADR-012 point 6): platform counts only, never a name. Pure (ADR-003).
import type { DraftEval } from '@credalent/jobs';
import { type AiTokenUse, type WorkspaceStatus, type WorkspaceStatusFact } from '@credalent/workspaces';
import { daysWaiting } from './workspaces.ts';

/** Each read on its own: `null` means that read failed, so only its tile shows the error. */
export type DashboardReads = {
  workspaces: WorkspaceStatusFact[] | null;
  /** Today's usage per workspace (null for one gone since the list); null when any read failed. */
  ai: (AiTokenUse | null)[] | null;
  /** The published catalogue's version, and the open draft's last save and eval state (null: no draft). */
  catalogue: { version: number; draft: { editedAt: Date; eval: DraftEval['status'] } | null } | null;
};

/** How long ago, in the largest whole unit under a day's 24 hours, then days (never negative). */
export type EditedAgo = { unit: 'minutes' | 'hours' | 'days'; count: number };

export type DashboardView = {
  /** Every status with its count, in STATUS_TILES order; null when the read failed. */
  statuses: { status: WorkspaceStatus; count: number }[] | null;
  /** Whole days the oldest workspace waiting for approval has waited; null when none waits. */
  oldestWaitingDays: number | null;
  /** `tokens` null: no AI call today, "Not yet available", never an invented 0. */
  ai: { tokens: number | null; nearBudget: number; atBudget: number } | null;
  /** The live version, and the waiting draft's age and eval state, or null for "No draft". */
  catalogue: { version: number; draft: { edited: EditedAgo; eval: DraftEval['status'] } | null } | null;
};

/** The status tiles in the order an operator acts on them (AIV-P2-051). */
export const STATUS_TILES = [
  'active',
  'pending_approval',
  'suspended',
  'rejected',
] as const satisfies WorkspaceStatus[];

/** A workspace at or above this share of its daily budget counts as near it (below 100%). */
const NEAR_BUDGET = 0.8;

export const statusHref = (status: WorkspaceStatus) =>
  status === 'pending_approval' ? ('/ops/approvals' as const) : (`/ops/workspaces?status=${status}` as const);
export const AI_SORTED_HREF = '/ops/workspaces?sort=ai' as const;

export function editedAgo(at: Date, now: Date): EditedAgo {
  const minutes = Math.max(0, Math.floor((now.getTime() - at.getTime()) / 60_000));
  if (minutes < 60) return { unit: 'minutes', count: minutes };
  if (minutes < 24 * 60) return { unit: 'hours', count: Math.floor(minutes / 60) };
  return { unit: 'days', count: Math.floor(minutes / (24 * 60)) };
}

const todayTokens = (u: AiTokenUse) => u.days[0]?.tokens ?? 0;
const share = (u: AiTokenUse) => todayTokens(u) / u.dailyBudget;

export function dashboardView({ workspaces, ai, catalogue }: DashboardReads, now: Date): DashboardView {
  const waiting = workspaces?.filter((w) => w.status === 'pending_approval') ?? [];
  const oldest = waiting.reduce<Date | null>((min, w) => (min && min <= w.createdAt ? min : w.createdAt), null);
  const used = ai?.filter((u) => u !== null) ?? [];
  const tokens = used.reduce((sum, u) => sum + todayTokens(u), 0);
  return {
    statuses:
      workspaces &&
      STATUS_TILES.map((status) => ({
        status,
        count: workspaces.filter((w) => w.status === status).length,
      })),
    oldestWaitingDays: oldest && daysWaiting(oldest, now),
    ai: ai && {
      tokens: tokens > 0 ? tokens : null,
      nearBudget: used.filter((u) => share(u) >= NEAR_BUDGET && share(u) < 1).length,
      atBudget: used.filter((u) => share(u) >= 1).length,
    },
    catalogue: catalogue && {
      version: catalogue.version,
      draft: catalogue.draft && { edited: editedAgo(catalogue.draft.editedAt, now), eval: catalogue.draft.eval },
    },
  };
}
