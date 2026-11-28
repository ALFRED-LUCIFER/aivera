// Upload limits, statuses and blob naming (AIV-P0-016). Pure: no I/O.

// `candidate_sheet`: a CSV or Excel file of candidates a recruiter imports (AIV-P1-103), read by the worker only.
export const PURPOSES = ['cv', 'evidence', 'portal', 'candidate_sheet'] as const;
export type Purpose = (typeof PURPOSES)[number];

export const FILE_STATUSES = ['pending', 'clean', 'infected', 'rejected'] as const;
export type FileStatus = (typeof FILE_STATUSES)[number];

const MB = 1024 * 1024;

/** The content type each allowed extension must declare; the extension and the declared type must agree. */
export const CONTENT_TYPES = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  // shortcut: Windows with Excel installed reports a .csv as application/vnd.ms-excel and is refused; accept that type too if pilot recruiters hit it.
  csv: 'text/csv',
} as const;
export type Extension = keyof typeof CONTENT_TYPES;

const documents = { extensions: ['pdf', 'png', 'jpg', 'jpeg', 'docx', 'pptx', 'xlsx'], maxBytes: 20 * MB } as const;

/**
 * Per purpose: the extensions allowed, the size limit, and the message (a key under `files` in packages/i18n) that
 * states both, shown as the picker's hint and as its error. The CApply and Portal artboards' copy.
 */
export const UPLOAD_LIMITS = {
  cv: { extensions: ['pdf', 'docx'], maxBytes: 10 * MB, message: 'limits.cv' },
  evidence: { ...documents, message: 'limits.evidence' },
  portal: { ...documents, message: 'limits.evidence' },
  candidate_sheet: { extensions: ['csv', 'xlsx'], maxBytes: 2 * MB, message: 'limits.sheet' },
} as const satisfies Record<Purpose, { extensions: readonly Extension[]; maxBytes: number; message: string }>;
export type LimitMessage = (typeof UPLOAD_LIMITS)[Purpose]['message'];

export type UploadRequest = { purpose: Purpose; fileName: string; contentType: string; size: number };

const extensionOf = (fileName: string) => fileName.slice(fileName.lastIndexOf('.') + 1).toLowerCase();

/** The content type a file name's extension stands for, or null when it is not one Credalent takes. */
export const contentTypeFor = (fileName: string): string | null =>
  Object.hasOwn(CONTENT_TYPES, extensionOf(fileName)) ? CONTENT_TYPES[extensionOf(fileName) as Extension] : null;

/** Null when the file is within its purpose's limits; otherwise the message the uploader sees. */
export function checkUpload({ purpose, fileName, contentType, size }: UploadRequest): LimitMessage | null {
  const limits = UPLOAD_LIMITS[purpose];
  const extension = extensionOf(fileName);
  const typed =
    (limits.extensions as readonly string[]).includes(extension) && contentTypeFor(fileName) === contentType;
  return typed && Number.isInteger(size) && size > 0 && size <= limits.maxBytes ? null : limits.message;
}

/** Where every upload lands first; nothing reads from it but the scan and the move. */
export const QUARANTINE = 'uploads-quarantine';
/**
 * The container a clean file is moved to. `cvs`: Blob container names take 3 to 63 characters, so not `cv`. A candidate
 * sheet is a list of candidates, so it is kept with the CVs.
 */
export const finalContainer = (purpose: Purpose) =>
  purpose === 'cv' || purpose === 'candidate_sheet' ? 'cvs' : 'evidence';
/** How long an upload SAS lives. */
export const UPLOAD_TTL_MS = 10 * 60_000;
/** A read link to one clean file is valid for 5 minutes (AIV-P1-045). */
export const READ_LINK_TTL_MS = 5 * 60_000;

/** Who owns a file: a workspace, or for a candidate-site upload the candidate account (ADR-009). */
export type Owner = { workspaceId: string } | { candidateAccountId: string };

/** The blob name: the owner and the file id, opaque ids only (AGENTS.md 1.2). Never the file's name. */
export const blobName = (owner: Owner, fileId: string) =>
  'workspaceId' in owner ? `w/${owner.workspaceId}/${fileId}` : `c/${owner.candidateAccountId}/${fileId}`;

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const QUARANTINE_PATH = new RegExp(`/${QUARANTINE}/([wc])/(${UUID})/(${UUID})$`);

/** The owner and file a quarantine blob's URL names (a scan result's `blobUri`); null for any other blob. */
export function parseQuarantineUrl(url: string): { owner: Owner; fileId: string } | null {
  const match = QUARANTINE_PATH.exec(new URL(url).pathname);
  if (!match) return null;
  const [, kind, ownerId = '', fileId = ''] = match;
  return { owner: kind === 'w' ? { workspaceId: ownerId } : { candidateAccountId: ownerId }, fileId };
}

export type FileErrorCode = LimitMessage | 'scanning_required' | 'not_found';

/** A refused file operation; `limits.*` codes are the uploader's message keys. Never carries the file's name. */
export class FileError extends Error {
  readonly code: FileErrorCode;
  constructor(code: FileErrorCode) {
    super(code);
    this.name = 'FileError';
    this.code = code;
  }
}
