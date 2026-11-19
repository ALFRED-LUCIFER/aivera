// The operator console's workspaces list and detail (AIV-P2-036, ADR-012). Pure: no React, no I/O (ADR-003).
import {
  MIN_REASON_LENGTH,
  STATUS_CHANGES,
  type AiTokenUse,
  type StatusChange,
  type WorkspaceStatus,
  type WorkspaceSummary,
} from '@aivera/workspaces';
import { z } from 'zod';

const PAGE_SIZE = 50;

/** The list request, sent in the server action's body, never in the URL: the name search and the 1-based page. */
export const workspaceSearchSchema = z.object({
  query: z.string().trim().max(100),
  page: z.int().min(1).max(10_000),
});
export type WorkspaceSearch = z.infer<typeof workspaceSearchSchema>;

/**
 * A workspace's platform facts, job count and AI token use (today in the list, the last 7 UTC days in the detail), as
 * the list and detail show them. `ai` is null when the usage store could not be read: "Not yet available".
 */
export type WorkspaceRow = WorkspaceSummary & { jobs: number; ai: AiTokenUse | null };

/** One page of the list, with the search that produced it. */
export type WorkspacePage = { search: WorkspaceSearch; total: number; rows: WorkspaceRow[] };

/** The list's view model: the search box (absent on the first load) and the table's state. */
export type WorkspacesListView = {
  search?: { query: string; onQueryChange: (query: string) => void; onSearch: () => void };
  table:
    | { status: 'loading' }
    | { status: 'error'; onRetry: () => void }
    | {
        status: 'ready';
        rows: WorkspaceRow[];
        /** The search these rows answer, for the "No workspace matches" message. */
        searched: string;
        page: number;
        pageCount: number;
        onPage: (page: number) => void;
      };
};

export const toDirectorySearch = ({ query, page }: WorkspaceSearch) => ({
  query,
  offset: (page - 1) * PAGE_SIZE,
  limit: PAGE_SIZE,
});

export const pageCount = (total: number) => Math.max(1, Math.ceil(total / PAGE_SIZE));

export const workspaceHref = (id: string) => `/ops/workspaces/${id}` as const;

/** The status change request (AIV-P2-037), validated again by the server action; the operator comes from the session. */
export const statusChangeSchema = z
  .object({
    workspaceId: z.uuid(),
    change: z.enum(['suspend', 'reactivate', 'approve', 'reject']),
    // Empty only for a change that needs no reason (approve, AIV-P2-039).
    reason: z.string().trim().max(500),
  })
  .refine(({ change, reason }) => !STATUS_CHANGES[change].reason || reason.length >= MIN_REASON_LENGTH, {
    path: ['reason'],
  });
export type StatusChangeRequest = z.input<typeof statusChangeSchema>;

/**
 * What the operator may do next on the detail page: suspend an active workspace, reactivate a suspended one. A workspace
 * waiting for approval is decided on the approvals page (AIV-P2-039); a rejected one has nothing left to change.
 */
export const nextChange = (status: WorkspaceStatus): StatusChange | null =>
  (({ active: 'suspend', suspended: 'reactivate', pending_approval: null, rejected: null }) as const)[status];

/** Confirm opens only once the reason is long enough, as the server requires. */
export const reasonReady = (reason: string) => reason.trim().length >= MIN_REASON_LENGTH;

/** Whether `change` may be confirmed with `reason`: approving needs none. */
export const canConfirmChange = (change: StatusChange, reason: string) =>
  !STATUS_CHANGES[change].reason || reasonReady(reason);

/** A workspace waiting for approval, as the approvals page lists it (AIV-P2-039): the creator's email, never a member. */
export type PendingRow = Pick<WorkspaceSummary, 'id' | 'name' | 'type' | 'createdAt'> & { creatorEmail: string | null };

/** Turning the approval switch on or off, with the operator's reason (AIV-P2-039). */
export const approvalModeSchema = z.object({
  required: z.boolean(),
  reason: z.string().trim().min(MIN_REASON_LENGTH).max(500),
});
export type ApprovalModeRequest = z.input<typeof approvalModeSchema>;

/** The approval switch card's view model. */
export type ApprovalModeView = {
  required: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reason: string;
  onReasonChange: (reason: string) => void;
  canConfirm: boolean;
  onConfirm: () => Promise<void>;
  /** The value just confirmed, for the success message; null before any change. */
  done: boolean | null;
};

/** An operator action on the workspace, from its own audit log: what, when, and the operator's reason. */
export type OperatorActionRow = {
  action: (typeof STATUS_CHANGES)[StatusChange]['action'] | 'ai_budget.changed';
  occurredAt: Date;
  reason: string | null;
};

/** The status change card's view model. */
export type StatusChangeView = {
  name: string;
  change: StatusChange;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reason: string;
  onReasonChange: (reason: string) => void;
  /** Whether the change needs a reason (approving does not). */
  needsReason: boolean;
  canConfirm: boolean;
  onConfirm: () => Promise<void>;
  /** The change just confirmed, for the success message; null before any. */
  done: StatusChange | null;
};
