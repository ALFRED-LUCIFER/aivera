// Platform settings the operators change from the console (AIV-P2-039, ADR-012 point 9). Pure: no I/O.

/** While the pilot runs, a new sign-up's workspace waits for an operator unless the setting is turned off. */
export const DEFAULT_APPROVAL_REQUIRED = true;

/** An operator's reason for changing a setting: at least this many characters once trimmed. */
export const MIN_REASON_LENGTH = 10;

const MESSAGES = {
  reason_required: 'Give a reason of at least 10 characters.',
  unchanged: 'The setting already has this value.',
} as const;

export type OpsErrorCode = keyof typeof MESSAGES;

/** A refused settings change. */
export class OpsError extends Error {
  readonly code: OpsErrorCode;
  constructor(code: OpsErrorCode) {
    super(MESSAGES[code]);
    this.name = 'OpsError';
    this.code = code;
  }
}
