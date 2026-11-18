// The only public surface of @aivera/audit (ADR-002).
import type { AuditContext } from '../application/audit.ts';
import type { AuditEntry, NewEntry, Subject } from '../domain/entry.ts';

export { AuditError } from '../domain/entry.ts';
export type {
  Action,
  Actor,
  ActorType,
  AuditEntry,
  AuditErrorCode,
  NewEntry,
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
}
