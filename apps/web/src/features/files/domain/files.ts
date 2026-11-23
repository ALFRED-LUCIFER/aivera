import {
  checkUpload,
  contentTypeFor,
  PURPOSES,
  UPLOAD_LIMITS,
  type FileStatus,
  type LimitMessage,
  type Purpose,
  type UploadRequest,
} from '@credalent/files';
import { z } from 'zod';

// Direct uploads to Blob storage (AIV-P0-016). Messages are keys under `files` in packages/i18n.

/** The server actions' input, validated again on the server (AGENTS.md 3.7). Never the workspace: that is the session's. */
export const uploadRequestSchema = z.strictObject({
  purpose: z.enum(PURPOSES),
  fileName: z.string().min(1).max(255),
  contentType: z.string().max(255),
  size: z.number().int().positive(),
});
export const fileIdSchema = z.uuid();

export type UploadMessage = LimitMessage | 'notAccepted' | 'failed';
export type RequestUploadResult = { ok: true; fileId: string; uploadUrl: string } | { ok: false; error: UploadMessage };

/** What the browser asks for: the type from the browser, or from the extension when the browser leaves it empty. */
export const uploadRequestFor = (purpose: Purpose, file: Pick<File, 'name' | 'type' | 'size'>): UploadRequest => ({
  purpose,
  fileName: file.name,
  contentType: file.type || contentTypeFor(file.name) || '',
  size: file.size,
});

/** The picker's `accept`: the purpose's extensions. */
export const acceptFor = (purpose: Purpose) => UPLOAD_LIMITS[purpose].extensions.map((e) => `.${e}`).join(',');

export { checkUpload };
export type { FileStatus, Purpose };

export type DirectUpload =
  | { phase: 'idle' }
  | { phase: 'uploading'; percent: number }
  /** `slow`: the scan is still running after about three minutes; polling goes on (AIV-P2-064). */
  | { phase: 'checking'; slow?: true }
  | { phase: 'done'; fileId: string }
  | { phase: 'error'; message: UploadMessage };

/** The uploader's message for a settled file that did not become clean. */
export const settledMessage = (status: FileStatus | null): UploadMessage =>
  status === 'infected' || status === 'rejected' ? 'notAccepted' : 'failed';
