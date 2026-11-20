// The only public surface of @credalent/audit (ADR-002).
import type { Tx } from '@credalent/db';
import type { AuditContext } from '../application/audit.ts';
import type {
  AuditEntry,
  NewEntry,
  NewPlatformEntry,
  PlatformEntryPage,
  PlatformEntryQuery,
  Subject,
} from '../domain/entry.ts';

export { AuditError, PLATFORM_ACTIONS } from '../domain/entry.ts';
export type {
  Action,
  Actor,
  ActorType,
  AuditEntry,
  AuditErrorCode,
  NewEntry,
  NewPlatformEntry,
  PlatformAction,
  PlatformEntry,
  PlatformEntryPage,
  PlatformEntryQuery,
  Subject,
  Values,
} from '../domain/entry.ts';
export type { AuditContext } from '../application/audit.ts';

/** Workspace ids and actors come from the request context, never from client input (ADR-005). */
export interface AuditContract {
  /**
   * Appends an entry inside the caller's `withWorkspace` transaction (`ctx.tx`), so it commits or rolls back with the
   * change it records. Make it the last statement before commit (AGENTS.md 3.6). Throws `AuditError`
   * (`unknown_action`, `note_required`, `personal_data`). `before` and `after` hold opaque ids, field names, enum
   * values and numbers, never names, contact details or free text about a candidate (AGENTS.md 1.2).
   */
  record(ctx: AuditContext, entry: NewEntry): Promise<void>;
  /** Every entry about `subject` in the workspace, oldest first. */
  listFor(workspaceId: string, subject: Subject): Promise<AuditEntry[]>;
  /**
   * The operator console's history of one workspace (ADR-012 points 6 and 8): only entries about the workspace itself
   * whose actor is an operator, oldest first, read inside that workspace's scope. Never a member's entry.
   */
  listOperatorEntries(workspaceId: string): Promise<AuditEntry[]>;
  /**
   * Appends an operator's action to the platform audit log (ADR-012): no workspace id, its own transaction. Throws
   * `AuditError('unknown_action')`. The actor is the operator's identity user id from the session, never client input.
   * An action on a workspace is also recorded there with `record`, inside `withWorkspace(<that workspace>)`: pass that
   * transaction as `tx` so both entries commit or roll back with the change. Also throws `note_required` and
   * `personal_data`, as `record` does.
   */
  recordPlatform(entry: NewPlatformEntry, tx?: Tx): Promise<void>;
  /**
   * The platform audit log for the operator console (ADR-012 point 8, AIV-P2-053): opaque ids, action, reason, time and
   * platform values, newest first, at most 50 a page. Filters by action, operator, target id and a time range (`from`
   * inclusive, `to` exclusive); pass the previous page's `nextCursor` as `cursor`. Reads through the database function
   * `audit.list_platform_entries`, so `aivera_app` still has no privilege on the table. Throws a `ZodError` for invalid
   * input before any query. Console code only (architecture rule `platform-audit-read-console-only`).
   */
  listPlatformEntries(query?: PlatformEntryQuery): Promise<PlatformEntryPage>;
}
