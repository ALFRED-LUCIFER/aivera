// An agency's clients in Settings > Clients (AIV-P1-056). Pure: no React, no I/O (ADR-003).
import { z } from 'zod';

/** A client as the page shows it: plain data only. */
export type ClientRow = { id: string; name: string; openJobs: number; archived: boolean };

export const CLIENT_NAME_MAX = 120;

/** What the client actions accept; the workspaces module checks the name again (trimmed, not empty, unique). */
export const clientNameSchema = z.string().trim().min(1).max(CLIENT_NAME_MAX);
export const clientIdSchema = z.uuid();

/** Why a client action was refused, for its message; `failed` is anything else. */
export type ClientError = 'name' | 'exists' | 'failed';
export type ClientResult = { ok: true } | { ok: false; error: ClientError };

/** Open jobs per client id: every job not closed. */
export function openJobsByClient(jobs: { clientId: string | null; stage: string }[]) {
  const counts = new Map<string, number>();
  for (const job of jobs)
    if (job.clientId && job.stage !== 'closed') counts.set(job.clientId, (counts.get(job.clientId) ?? 0) + 1);
  return counts;
}

/** The Clients view model: the list, the add field, and the rename and archive dialogs. */
export type ClientsView = {
  rows: ClientRow[];
  name: string;
  onNameChange: (name: string) => void;
  onAdd: () => Promise<void>;
  /** The add form's refusal (`name`, `exists`), or a change that failed (`failed`); null when there is none. */
  error: ClientError | null;
  pending: boolean;
  renaming: { id: string; name: string; error: ClientError | null } | null;
  onRenameOpen: (row: ClientRow) => void;
  onRenameChange: (name: string) => void;
  onRename: () => Promise<void>;
  archiving: ClientRow | null;
  onArchiveOpen: (row: ClientRow) => void;
  onArchive: () => Promise<void>;
  /** Closes the open dialog. */
  onClose: () => void;
  /** The last change, for the status message; null before any. */
  done: 'added' | 'renamed' | 'archived' | null;
};
