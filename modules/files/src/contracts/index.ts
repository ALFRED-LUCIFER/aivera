// The only public surface of @credalent/files (ADR-002). Pure values only here: the web app's browser code reads the
// limits from this entry too.
import type { EventDefinition } from '@credalent/db/outbox';
import type { WorkspaceContext } from '@credalent/workspaces';
import { z } from 'zod';
import type { Download, ReadLink, UploadTicket } from '../application/files.ts';
import type { FileStatus, Purpose, UploadRequest } from '../domain/files.ts';

export { checkUpload, contentTypeFor, FileError, PURPOSES, UPLOAD_LIMITS } from '../domain/files.ts';
export type { FileErrorCode, FileStatus, LimitMessage, Purpose, UploadRequest } from '../domain/files.ts';
export type { Download, ReadLink, UploadTicket } from '../application/files.ts';

/** The ticket's "file.clean": a workspace's upload passed the scan and sits in its final container. Opaque ids only. */
export const FileCleanV1 = {
  type: 'FileClean.v1',
  payload: z.strictObject({ fileId: z.uuid() }),
} satisfies EventDefinition<{ fileId: string }>;

/** The ticket's "file.rejected": the upload was deleted, as infected or as not what was asked for. */
export const FileRejectedV1 = {
  type: 'FileRejected.v1',
  payload: z.strictObject({ fileId: z.uuid(), reason: z.enum(['infected', 'rejected']) }),
} satisfies EventDefinition<{ fileId: string; reason: 'infected' | 'rejected' }>;

/**
 * Every call takes the request context from `WorkspacesContract.withWorkspace`, so the workspace never comes from
 * client input (ADR-005). Uploading and reading one's own upload status is `file.upload` (admins and recruiters);
 * downloading is `file.download`, for admins and recruiters only: hiring owners and interviewers see summaries and
 * sources, not raw candidate files (AGENTS.md 1.9).
 */
export interface FilesContract {
  /**
   * Checks the purpose's limits (`FileError('limits.cv' | 'limits.evidence')`, the uploader's message), records a
   * pending file and returns a SAS URL that may create that one blob in uploads-quarantine, once and never overwrite it, for 10 minutes.
   */
  requestUpload(ctx: WorkspaceContext, input: UploadRequest): Promise<UploadTicket>;
  /** The caller's own upload's status; null when it is not theirs or not in the workspace. */
  getStatus(ctx: WorkspaceContext, fileId: string): Promise<FileStatus | null>;
  /**
   * The caller's own upload's purpose and hash once it is clean, for the caller to link it to a record (AIV-P1-019);
   * null when it is pending, infected, rejected, not theirs or not in the workspace. `file.upload`.
   */
  findCleanUpload(ctx: WorkspaceContext, fileId: string): Promise<{ purpose: Purpose; sha256: string } | null>;
  /**
   * Dev only: once the browser reports the upload done, re-checks the blob's size and stored content type and settles it clean
   * (or rejected) without a scan. Throws `FileError('scanning_required')` wherever malware scanning is on.
   */
  markCleanWithoutScan(ctx: WorkspaceContext, fileId: string): Promise<FileStatus>;
  /** A clean file's bytes; null for another workspace's file, a missing one, or one not clean. */
  openDownload(ctx: WorkspaceContext, fileId: string): Promise<Download | null>;
  /**
   * A link that reads one clean file of the context's workspace for 5 minutes, as an attachment (AIV-P1-045): the way
   * a recruiter opens a candidate's uploaded evidence. `file.download`: admins and recruiters; a hiring owner or
   * interviewer gets `ForbiddenError` (AGENTS.md 1.9). Audited (`file.link_issued`: actor, time, the file id) as the
   * last statement. Null, with nothing audited, for another workspace's file, a missing one, or one not clean.
   */
  issueReadLink(ctx: WorkspaceContext, fileId: string): Promise<ReadLink | null>;
  /**
   * The worker's handler for one Defender for Storage scan result (an Event Grid event): "No threats found" settles the
   * file clean, "Malicious" infected; a result for a blob outside quarantine is ignored. Throws `ZodError` on a body
   * that is not a scan result (dead-letter it), and any other error to be retried.
   */
  handleScanResult(body: unknown): Promise<void>;
}
