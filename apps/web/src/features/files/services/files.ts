'use server';

import { FileError, type FileStatus } from '@credalent/files';
import { log } from '@credalent/observability';
import { forbidden, unstable_rethrow } from 'next/navigation';
import { getFiles } from '@/server/files';
import { inActiveWorkspace } from '@/server/workspace';
import { fileIdSchema, uploadRequestSchema, type RequestUploadResult } from '../domain/files.ts';

// The upload actions (AIV-P0-016). The files module authorises `file.upload` (admins and recruiters; anyone else gets
// the 403 page). Nothing about the file but ids reaches a log (AGENTS.md 1.2).

async function inWorkspace<T>(work: Parameters<typeof inActiveWorkspace<T>>[0]): Promise<T> {
  const result = await inActiveWorkspace(work);
  if (!result) forbidden();
  return result.value;
}

/** Checks the limits, records the file and returns the SAS URL the browser PUTs it to. */
export async function requestUpload(input: unknown): Promise<RequestUploadResult> {
  const parsed = uploadRequestSchema.safeParse(input);
  const files = getFiles()?.files;
  if (!parsed.success || !files) return { ok: false, error: 'failed' };
  try {
    const { fileId, uploadUrl } = await inWorkspace((ctx) => files.requestUpload(ctx, parsed.data));
    return { ok: true, fileId, uploadUrl };
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof FileError && error.code.startsWith('limits.'))
      return { ok: false, error: error.code as 'limits.cv' };
    log.error(
      { area: 'files', 'error.type': error instanceof Error ? error.name : 'unknown' },
      'upload request failed',
    );
    return { ok: false, error: 'failed' };
  }
}

/**
 * The browser finished its PUT. With malware scanning on, Defender's result settles the file, so this only reads its
 * status. Off (dev only), the server re-checks the blob and settles it here.
 */
export async function completeUpload(fileId: string): Promise<FileStatus | null> {
  const id = fileIdSchema.safeParse(fileId);
  const configured = getFiles();
  if (!id.success || !configured) return null;
  const { files, malwareScanning } = configured;
  return inWorkspace((ctx) =>
    malwareScanning ? files.getStatus(ctx, id.data) : files.markCleanWithoutScan(ctx, id.data),
  );
}

/** The caller's own upload's status, while the scan runs. */
export async function uploadStatus(fileId: string): Promise<FileStatus | null> {
  const id = fileIdSchema.safeParse(fileId);
  const files = getFiles()?.files;
  if (!id.success || !files) return null;
  return inWorkspace((ctx) => files.getStatus(ctx, id.data));
}
