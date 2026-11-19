// The operator console's workspaces list and detail (AIV-P2-036, ADR-012). Pure: no React, no I/O (ADR-003).
import {
  MIN_REASON_LENGTH,
  type AiTokenUse,
  type STATUS_CHANGES,
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
export const statusChangeSchema = z.object({
  workspaceId: z.uuid(),
  change: z.enum(['suspend', 'reactivate']),
  reason: z.string().trim().min(MIN_REASON_LENGTH).max(500),
});
export type StatusChangeRequest = z.infer<typeof statusChangeSchema>;

/** What the operator may do next: suspend an active workspace, reactivate a suspended one. */
export const nextChange = (status: WorkspaceStatus): StatusChange =>
  status === 'suspended' ? 'reactivate' : 'suspend';

/** Confirm opens only once the reason is long enough, as the server requires. */
export const reasonReady = (reason: string) => reason.trim().length >= MIN_REASON_LENGTH;

/** An operator action on the workspace, from its own audit log: what, when, and the operator's reason. */
export type OperatorActionRow = {
  action: (typeof STATUS_CHANGES)[StatusChange]['action'];
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
  canConfirm: boolean;
  onConfirm: () => Promise<void>;
  /** The change just confirmed, for the success message; null before any. */
  done: StatusChange | null;
};
