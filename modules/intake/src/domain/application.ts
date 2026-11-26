// An application links one person to one job and records every way it arrived (AIV-P1-017).

/** Where an application came from, as the Inbox shows it; `recruiter` is a link a member added (AIV-P1-076). */
export const SOURCES = ['linkedin', 'careers_page', 'referral', 'email', 'whatsapp', 'recruiter'] as const;
export type Source = (typeof SOURCES)[number];

/**
 * Where an application stands. There is no rejected stage: nothing rejects a candidate automatically, and a person
 * who decides against one records it in the decision pack (AIV-P1-114: `interview` once a person chose them for
 * interview; AGENTS.md 1.5). `round2_shortlist` and `not_advanced` follow the hiring owner's recorded decision
 * (AIV-P2-012): "Not advanced" stays in the ranking and can join a later pack.
 */
export const STAGES = [
  'new',
  'first_pass_done',
  'assessing',
  'interview',
  'in_process',
  'in_pool',
  'withdrawn',
  'round2_shortlist',
  'not_advanced',
] as const;
export type Stage = (typeof STAGES)[number];

/** A hiring owner's recorded decision on a decision pack, as `DecisionsRecorded.v1`'s consumer reads it (AIV-P2-012). */
export type RecordedDecision = {
  candidateId: string;
  decision: 'advance' | 'hold' | 'do_not_advance';
  decidedBy: string;
  note: string;
};

/** The stage a recorded decision moves an application to; `hold` keeps the stage it has. */
export const stageAfter = (decision: RecordedDecision['decision']): Stage | null =>
  decision === 'advance' ? 'round2_shortlist' : decision === 'do_not_advance' ? 'not_advanced' : null;

/** The longest reason a recruiter may give for choosing people for interview (AIV-P1-114). */
export const CHOICE_REASON_MAX = 500;

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
  /** Portfolio or repository links the candidate sent, or a member added. */
  links: string[];
  /** The GitHub login the candidate supplied, never one derived from their name, email or a repository owner. */
  githubLogin: string | null;
  /**
   * The confirmed batch a member added it in (AIV-P1-104); null for an arrival with none, which the worker never reads.
   * Links later added to an application inherit its batch.
   */
  batchId: string | null;
};

/** One confirmation that the recruiter is responsible for the right to process the CVs added together (AIV-P1-104). */
export type ImportBatch = {
  id: string;
  workspaceId: string;
  jobId: string;
  confirmedBy: string;
  confirmedAt: Date;
  /** The message key shown at confirmation, e.g. `import.rightToProcess.v1`: a new wording is a new key. */
  wordingKey: string;
  /** The key's version suffix, e.g. `v1`. */
  wordingVersion: string;
  cvs: number;
};

const WORDING_KEY = /^import\.rightToProcess\.(v[1-9]\d{0,3})$/;

/** The version suffix of a confirmation wording key, or null when the key is not one (the key comes from the app, never the browser). */
export const wordingVersion = (key: string): string | null => WORDING_KEY.exec(key)?.[1] ?? null;

/**
 * Field names in this module's contract that hold candidate personal data (AGENTS.md 1.2), for the telemetry scrubber
 * (AIV-P0-018) to register. Never log them.
 */
export const PERSONAL_DATA_FIELDS = ['links', 'githubLogin'] as const;

const MESSAGES = {
  job_not_found: 'Job not found',
  application_not_found: 'Application not found',
  confirmation_required: 'Confirm you are responsible for the right to process these CVs.',
  invalid_wording: 'Unknown confirmation wording',
  not_synthetic: 'Only a synthetic demo workspace can be purged.',
  not_on_job: 'This candidate has not applied to this job',
  reason_required: 'Give a reason for this choice',
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
