import { createHash } from 'node:crypto';
import type { NewEntry } from '@credalent/audit';
import type { Tx } from '@credalent/db/client';
import type { Action, WorkspaceContext } from '@credalent/workspaces';
import {
  blobName,
  checkUpload,
  FileError,
  finalContainer,
  QUARANTINE,
  READ_LINK_TTL_MS,
  UPLOAD_TTL_MS,
  type FileStatus,
  type Owner,
  type Purpose,
  type UploadRequest,
} from '../domain/files.ts';

export type FileRecord = {
  id: string;
  workspaceId: string | null;
  candidateAccountId: string | null;
  purpose: Purpose;
  contentType: string;
  /** As uploaded (AIV-P1-165); it can name the candidate, so it is shown on screen only, never logged. */
  fileName?: string | null;
  sizeBytes: number;
  sha256: string | null;
  status: FileStatus;
  blobPath: string;
  uploadedBy: string;
  createdAt: Date;
};

/** The store over one owner-scoped transaction. `find` filters by owner (the first layer; RLS is the second). */
export type FileStore = {
  insert(file: FileRecord): Promise<void>;
  /** The owner's files' names, by id; a file with no stored name is left out. */
  names(owner: Owner, ids: string[]): Promise<Map<string, string>>;
  /** `forUpdate` locks the row to the transaction's end, so two scan results for one file settle it once. */
  find(owner: Owner, id: string, forUpdate?: boolean): Promise<FileRecord | null>;
  /** Filters by owner too, so a file id from elsewhere changes nothing. */
  settle(
    owner: Owner,
    id: string,
    change: Pick<FileRecord, 'status'> & Partial<Pick<FileRecord, 'sha256' | 'blobPath'>>,
  ): Promise<void>;
};

/** Blob storage. Paths are `<container>/<blob name>`. */
export type BlobStore = {
  /**
   * A URL that may create the one blob at `path` until `expiresOn`, and nothing else: no read, no other blob, and no
   * overwrite once it exists, so the bytes Defender scanned are the bytes that are settled.
   */
  uploadUrl(path: string, expiresOn: Date): Promise<string>;
  /**
   * A URL that may read the one blob at `path` until `expiresOn`, and nothing else; the answer is an attachment of
   * `contentType`, so the browser saves it and never renders it.
   */
  readUrl(path: string, expiresOn: Date, contentType: string): Promise<string>;
  /**
   * The blob's size and stored content type, and its bytes when it is no bigger than `maxBytes` (null data otherwise,
   * so an oversized upload is never loaded into memory); null when there is no such blob.
   */
  read(
    path: string,
    maxBytes: number,
  ): Promise<{ size: number; contentType: string | undefined; data: Buffer | null } | null>;
  write(path: string, data: Buffer, contentType: string): Promise<void>;
  /** Deletes the blob if it exists. */
  delete(path: string): Promise<void>;
};

export type Ports = {
  storeFor(tx: Tx): FileStore;
  blobs: BlobStore;
  /** Runs `work` in the owner's row-level security scope (a workspace, or a candidate account). */
  inScope<T>(owner: Owner, work: (tx: Tx) => Promise<T>): Promise<T>;
  /** Writes FileClean.v1 or FileRejected.v1 to the outbox in `tx`; only a workspace's file has a workspace to send to. */
  publishSettled(
    tx: Tx,
    file: FileRecord & { workspaceId: string },
    status: Exclude<FileStatus, 'pending'>,
  ): Promise<void>;
  authorize(ctx: WorkspaceContext, action: Action): Promise<void>;
  /** Appends an audit entry in `ctx.tx`; the last statement before commit (AGENTS.md 3.6). */
  audit(ctx: WorkspaceContext, entry: NewEntry): Promise<void>;
  /** True wherever the environment requires Defender's scan (the pilot and production); never configurable per call. */
  malwareScanning: boolean;
  newId(): string;
  now(): Date;
};

export type UploadTicket = { fileId: string; uploadUrl: string; expiresAt: Date };
export type ReadLink = { url: string; expiresAt: Date };
export type ScanVerdict = 'clean' | 'infected';

const sha256 = (data: Buffer) => createHash('sha256').update(data).digest('hex');

export function filesUseCases(p: Ports) {
  /**
   * Moves a pending file out of quarantine. Clean, and the blob's size and stored content type match the request: copied to its
   * final container, hashed, `clean`. Infected, or not what was asked for: deleted, `infected` or `rejected`. Settling
   * an already settled file changes nothing, so a redelivered scan result is harmless.
   */
  async function settle(tx: Tx, owner: Owner, file: FileRecord, verdict: ScanVerdict): Promise<FileStatus> {
    if (file.status !== 'pending') return file.status;
    const store = p.storeFor(tx);
    const quarantine = file.blobPath;
    const final = `${finalContainer(file.purpose)}/${quarantine.slice(QUARANTINE.length + 1)}`;
    const publish = (status: Exclude<FileStatus, 'pending'>) =>
      file.workspaceId ? p.publishSettled(tx, { ...file, workspaceId: file.workspaceId }, status) : undefined;
    if (verdict === 'clean') {
      // The final copy too: a retry after a failed commit finds quarantine already emptied.
      const blob = (await p.blobs.read(quarantine, file.sizeBytes)) ?? (await p.blobs.read(final, file.sizeBytes));
      // shortcut: the content type checked is the one the browser stored with the blob, not a sniff of its bytes (an .exe sent as
      // application/pdf passes); download headers (attachment, nosniff, sandbox) limit the harm. CV parsing checks a CV's
      // magic bytes (AIV-P1-025); sniff here too when other purposes are read by the server.
      if (blob?.data && blob.size === file.sizeBytes && blob.contentType === file.contentType) {
        await p.blobs.write(final, blob.data, file.contentType);
        await store.settle(owner, file.id, { status: 'clean', sha256: sha256(blob.data), blobPath: final });
        await publish('clean');
        await p.blobs.delete(quarantine);
        return 'clean';
      }
    }
    // Deleted before the row changes, so a failed commit is retried with the blob already gone, never left behind.
    // shortcut: settling is recorded on the files.file row, not in the audit log, which needs a member's context the
    // worker does not have; audit it when the audit module takes a system actor (AIV-P5-E03, #34)
    await p.blobs.delete(quarantine);
    const status = verdict === 'infected' ? 'infected' : 'rejected';
    await store.settle(owner, file.id, { status });
    await publish(status);
    return status;
  }

  return {
    async requestUpload(ctx: WorkspaceContext, input: UploadRequest): Promise<UploadTicket> {
      await p.authorize(ctx, 'file.upload');
      const refused = checkUpload(input);
      if (refused) throw new FileError(refused);
      const id = p.newId();
      const createdAt = p.now();
      const blobPath = `${QUARANTINE}/${blobName({ workspaceId: ctx.workspaceId }, id)}`;
      await p.storeFor(ctx.tx).insert({
        id,
        workspaceId: ctx.workspaceId,
        candidateAccountId: null,
        purpose: input.purpose,
        contentType: input.contentType,
        fileName: input.fileName,
        sizeBytes: input.size,
        sha256: null,
        status: 'pending',
        blobPath,
        uploadedBy: ctx.userId,
        createdAt,
      });
      const expiresAt = new Date(createdAt.getTime() + UPLOAD_TTL_MS);
      return { fileId: id, uploadUrl: await p.blobs.uploadUrl(blobPath, expiresAt), expiresAt };
    },

    async fileNames(ctx: WorkspaceContext, fileIds: string[]): Promise<Map<string, string>> {
      await p.authorize(ctx, 'file.upload');
      return p.storeFor(ctx.tx).names({ workspaceId: ctx.workspaceId }, fileIds);
    },

    async getStatus(ctx: WorkspaceContext, fileId: string): Promise<FileStatus | null> {
      await p.authorize(ctx, 'file.upload');
      const file = await p.storeFor(ctx.tx).find({ workspaceId: ctx.workspaceId }, fileId);
      return file?.uploadedBy === ctx.userId ? file.status : null;
    },

    async findCleanUpload(ctx: WorkspaceContext, fileId: string): Promise<{ purpose: Purpose; sha256: string } | null> {
      await p.authorize(ctx, 'file.upload');
      const file = await p.storeFor(ctx.tx).find({ workspaceId: ctx.workspaceId }, fileId);
      // SAFETY: only a clean file is offered for linking; a clean file always has its hash (settle sets both).
      if (file?.uploadedBy !== ctx.userId || file.status !== 'clean' || !file.sha256) return null;
      return { purpose: file.purpose, sha256: file.sha256 };
    },

    // shortcut: malware scanning off in dev (synthetic data, owner decision 20 Nov 2026); the pilot sets
    // MALWARE_SCANNING=on, and this path then refuses before reading anything.
    async markCleanWithoutScan(ctx: WorkspaceContext, fileId: string): Promise<FileStatus> {
      await p.authorize(ctx, 'file.upload');
      if (p.malwareScanning) throw new FileError('scanning_required');
      const file = await p.storeFor(ctx.tx).find({ workspaceId: ctx.workspaceId }, fileId, true);
      if (file?.uploadedBy !== ctx.userId) throw new FileError('not_found');
      return settle(ctx.tx, { workspaceId: ctx.workspaceId }, file, 'clean');
    },

    async issueReadLink(ctx: WorkspaceContext, fileId: string): Promise<ReadLink | null> {
      // SAFETY: raw candidate files are for admins and recruiters; a hiring owner or interviewer is refused (AGENTS.md 1.9).
      await p.authorize(ctx, 'file.download');
      const file = await p.storeFor(ctx.tx).find({ workspaceId: ctx.workspaceId }, fileId);
      // SAFETY: only a clean file leaves storage; pending, infected and rejected files read as not found.
      if (file?.status !== 'clean') return null;
      const expiresAt = new Date(p.now().getTime() + READ_LINK_TTL_MS);
      const url = await p.blobs.readUrl(file.blobPath, expiresAt, file.contentType);
      // SAFETY: no link leaves without its audit entry: a failed write rolls back and the link is never returned.
      await p.audit(ctx, { action: 'file.link_issued', subject: { type: 'file', id: file.id } });
      return { url, expiresAt };
    },

    /** Applies one Defender scan result to the file its blob URL names; a URL naming no file is ignored. */
    async applyScanResult(target: { owner: Owner; fileId: string }, verdict: ScanVerdict): Promise<FileStatus | null> {
      return p.inScope(target.owner, async (tx) => {
        const file = await p.storeFor(tx).find(target.owner, target.fileId, true);
        return file ? settle(tx, target.owner, file, verdict) : null;
      });
    },

    /**
     * A CV the worker fetched from an imported sheet's link (AIV-P1-103), stored as an upload by `uploadedBy` would be:
     * a pending `cv` file in quarantine, then Defender's scan, or settled at once where scanning is off (dev only).
     * Null, storing nothing, when it is outside the CV limits. The row commits before the blob is written, so a scan
     * result never arrives for a file it cannot find.
     */
    async storeFetchedCv(
      workspaceId: string,
      uploadedBy: string,
      data: Buffer,
      contentType: string,
    ): Promise<string | null> {
      const extension = contentType === 'application/pdf' ? 'pdf' : 'docx';
      if (checkUpload({ purpose: 'cv', fileName: `cv.${extension}`, contentType, size: data.length })) return null;
      const owner = { workspaceId };
      const id = p.newId();
      const blobPath = `${QUARANTINE}/${blobName(owner, id)}`;
      const file: FileRecord = {
        id,
        workspaceId,
        candidateAccountId: null,
        purpose: 'cv',
        contentType,
        sizeBytes: data.length,
        sha256: null,
        status: 'pending',
        blobPath,
        uploadedBy,
        createdAt: p.now(),
      };
      await p.inScope(owner, (tx) => p.storeFor(tx).insert(file));
      await p.blobs.write(blobPath, data, contentType);
      // shortcut: malware scanning off in dev (synthetic data, owner decision 20 Nov 2026); the pilot sets MALWARE_SCANNING=on.
      if (!p.malwareScanning) await p.inScope(owner, (tx) => settle(tx, owner, file, 'clean'));
      return id;
    },
  };
}

/**
 * A clean workspace file's purpose, content type and bytes, read as the system in a workspace-scoped transaction (CV
 * parsing, AIV-P1-025). `pending` while it waits for its scan; `rejected` when it will never be clean (infected,
 * rejected, missing, or its blob gone), so a reader can stop waiting.
 */
export async function readCleanFile(
  p: Pick<Ports, 'storeFor'> & { blobs: Pick<BlobStore, 'read'> },
  tx: Tx,
  workspaceId: string,
  fileId: string,
): Promise<{ purpose: Purpose; contentType: string; data: Buffer } | 'pending' | 'rejected'> {
  const file = await p.storeFor(tx).find({ workspaceId }, fileId);
  if (file?.status === 'pending') return 'pending';
  // SAFETY: only a clean file is read; a file in quarantine is never parsed.
  if (file?.status !== 'clean') return 'rejected';
  const blob = await p.blobs.read(file.blobPath, file.sizeBytes);
  if (!blob?.data) return 'rejected';
  return { purpose: file.purpose, contentType: file.contentType, data: blob.data };
}
