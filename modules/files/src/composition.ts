// Builds the files module for an app (ADR-002: only apps and tests import this).
// Not the @credalent/db index: it also exports the migrator, whose module paths do not resolve inside a Next.js bundle.
import type { Db, Tx } from '@credalent/db/client';
import { enqueue } from '@credalent/db/outbox';
import { uuidv7 } from '@credalent/db/uuidv7';
import { withCandidateAccount, withWorkspace } from '@credalent/db/with-workspace';
import type { WorkspacesContract } from '@credalent/workspaces';
import { filesUseCases, readCleanFile, type BlobStore } from './application/files.ts';
import { FileCleanV1, FileRejectedV1, type FilesContract } from './contracts/index.ts';
import { fileStore } from './infrastructure/repository.ts';
import { parseScanResult } from './infrastructure/scanResult.ts';
import { outbox } from './infrastructure/schema.ts';

export { createBlobStore, type BlobStoreConfig } from './infrastructure/blobs.ts';
export type { BlobStore } from './application/files.ts';

/** The Service Bus queue Event Grid delivers Defender's scan results to (infra/modules/storage.bicep). */
export const SCAN_RESULTS_QUEUE = 'malware-scan-results';

/**
 * `malwareScanning` comes from the app's validated environment (MALWARE_SCANNING; required on in the pilot and
 * production). `now` is the injected clock (AGENTS.md 3.9).
 */
export function createFiles(config: {
  db: Db;
  workspaces: Pick<WorkspacesContract, 'authorize'>;
  blobs: BlobStore;
  malwareScanning: boolean;
  now?: () => Date;
}): FilesContract {
  const { db, workspaces, blobs, malwareScanning } = config;
  const now = config.now ?? (() => new Date());
  const useCases = filesUseCases({
    storeFor: fileStore,
    blobs,
    inScope: (owner, work) =>
      'workspaceId' in owner
        ? withWorkspace(db, owner.workspaceId, work)
        : withCandidateAccount(db, owner.candidateAccountId, work),
    publishSettled: (tx, file, status) => {
      const input = { workspaceId: file.workspaceId, dedupeKey: `file:${file.id}`, occurredAt: now() };
      return status === 'clean'
        ? enqueue(tx, outbox, FileCleanV1, { ...input, payload: { fileId: file.id } })
        : enqueue(tx, outbox, FileRejectedV1, { ...input, payload: { fileId: file.id, reason: status } });
    },
    authorize: (ctx, action) => workspaces.authorize(ctx, action),
    malwareScanning,
    newId: uuidv7,
    now,
  });
  return {
    ...useCases,
    async handleScanResult(body) {
      const result = parseScanResult(body);
      if (result) await useCases.applyScanResult(result.target, result.verdict);
    },
  };
}

/** `readCleanFile` over the worker's transaction (CV parsing, AIV-P1-025). */
export function createCleanFileReader(blobs: Pick<BlobStore, 'read'>) {
  return (tx: Tx, workspaceId: string, fileId: string) =>
    readCleanFile({ storeFor: fileStore, blobs }, tx, workspaceId, fileId);
}
