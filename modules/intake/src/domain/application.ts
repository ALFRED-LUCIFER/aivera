// An application links one person to one job and records every way it arrived (AIV-P1-017).

/** Where an application came from, as the Inbox shows it. */
export const SOURCES = ['linkedin', 'careers_page', 'referral', 'email', 'whatsapp'] as const;
export type Source = (typeof SOURCES)[number];

/**
 * Where an application stands. There is no rejected stage: nothing rejects a candidate automatically, and a person
 * who decides against one records it in the decision pack (AGENTS.md 1.5).
 */
export const STAGES = ['new', 'first_pass_done', 'assessing', 'in_process', 'in_pool', 'withdrawn'] as const;
export type Stage = (typeof STAGES)[number];

export type Application = {
  id: string;
  workspaceId: string;
  personId: string;
  jobId: string;
  stage: Stage;
  /** When the first source arrived. */
  receivedAt: Date;
  submittedToClientAt: Date | null;
};

/** One arrival of an application. A second arrival for the same person and job adds a source, not an application. */
export type ApplicationSource = {
  id: string;
  workspaceId: string;
  applicationId: string;
  source: Source;
  receivedAt: Date;
  /** Blob file ids of the CV and other files (AIV-P0-016); opaque, never the file name. */
  fileIds: string[];
  /** Portfolio or repository links the candidate sent. */
  links: string[];
};

/**
 * Field names in this module's contract that hold candidate personal data (AGENTS.md 1.2), for the telemetry scrubber
 * (AIV-P0-018) to register. Never log them.
 */
export const PERSONAL_DATA_FIELDS = ['links'] as const;

const MESSAGES = {
  job_not_found: 'Job not found',
} as const;

export type IntakeErrorCode = keyof typeof MESSAGES;

/** A refused intake operation. The message never repeats the refused value (AGENTS.md 1.2). */
export class IntakeError extends Error {
  readonly code: IntakeErrorCode;
  constructor(code: IntakeErrorCode) {
    super(MESSAGES[code]);
    this.name = 'IntakeError';
    this.code = code;
  }
}
