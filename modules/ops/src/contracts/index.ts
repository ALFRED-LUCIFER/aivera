// The only public surface of @aivera/ops (ADR-002, ADR-012 point 9). No ranking module may import it (AGENTS.md 1.8).
import type { SetApprovalRequiredInput } from '../application/settings.ts';

export { OpsError } from '../domain/settings.ts';
export type { OpsErrorCode } from '../domain/settings.ts';
export type { SetApprovalRequiredInput } from '../application/settings.ts';

/** Platform settings (AIV-P2-039). Changes are for operators only: callers check the platformOperator policy first. */
export interface OpsSettingsContract {
  /** Whether a new sign-up's workspace waits for approval; on until an operator turns it off. */
  approvalRequired(): Promise<boolean>;
  /**
   * Turns the approval switch on or off with the operator's reason, audited last in the platform log
   * (`ops.approval_mode_changed`, before and after) in the same transaction. Approves or rejects nothing on its own.
   * Throws `OpsError` (`reason_required`, `unchanged`).
   */
  setApprovalRequired(input: SetApprovalRequiredInput): Promise<void>;
}
