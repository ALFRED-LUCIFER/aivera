// The console home's stat tiles (AIV-P2-051, ADR-012 point 6): platform counts only, never a name. Pure (ADR-003).
import { type AiTokenUse, type WorkspaceStatus, type WorkspaceStatusFact } from '@credalent/workspaces';
import { daysWaiting } from './workspaces.ts';

/** Each read on its own: `null` means that read failed, so only its tile shows the error. */
export type DashboardReads = {
  workspaces: WorkspaceStatusFact[] | null;
  /** Today's usage per workspace (null for one gone since the list); null when any read failed. */
  ai: (AiTokenUse | null)[] | null;
  /** The published catalogue's version number. */
  catalogueVersion: number | null;
};

export type DashboardView = {
  /** Every status with its count, in STATUS_TILES order; null when the read failed. */
  statuses: { status: WorkspaceStatus; count: number }[] | null;
  /** Whole days the oldest workspace waiting for approval has waited; null when none waits. */
  oldestWaitingDays: number | null;
  /** `tokens` null: no AI call today, "Not yet available", never an invented 0. */
  ai: { tokens: number | null; nearBudget: number; atBudget: number } | null;
  // shortcut: the version only; the draft line ("1 draft waiting · last edited …", eval state) waits on the catalogue
  // draft (AIV-P2-045, #362) and its eval (AIV-P2-048, #365). Add `draft` here, read through the jobs catalogue contract.
  catalogue: { version: number } | null;
};

/** The status tiles in the order an operator acts on them (AIV-P2-051). */
export const STATUS_TILES = [
  'active',
  'pending_approval',
  'suspended',
  'rejected',
] as const satisfies WorkspaceStatus[];

/** A workspace at or above this share of its daily budget counts as near it (below 100%). */
export const NEAR_BUDGET = 0.8;

export const statusHref = (status: WorkspaceStatus) =>
  status === 'pending_approval' ? ('/ops/approvals' as const) : (`/ops/workspaces?status=${status}` as const);
export const AI_SORTED_HREF = '/ops/workspaces?sort=ai' as const;

const todayTokens = (u: AiTokenUse) => u.days[0]?.tokens ?? 0;
const share = (u: AiTokenUse) => todayTokens(u) / u.dailyBudget;

export function dashboardView({ workspaces, ai, catalogueVersion }: DashboardReads, now: Date): DashboardView {
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
    catalogue: catalogueVersion === null ? null : { version: catalogueVersion },
  };
}
