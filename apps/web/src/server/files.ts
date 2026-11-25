import { createAudit } from '@credalent/audit/composition';
import type { FilesContract } from '@credalent/files';
import { createBlobStore, createFiles } from '@credalent/files/composition';
import { getDb } from './db';
import { env } from './env';
import { getWorkspaces } from './workspace';

let files: FilesContract | undefined;

/**
 * The app's files module (AIV-P0-016), signed in to Blob storage with the app identity; null when this environment
 * has no storage account, so no upload or download is offered.
 */
export function getFiles(): { files: FilesContract; malwareScanning: boolean } | null {
  const { AZURE_STORAGE_BLOB_URL: url, MALWARE_SCANNING } = env();
  if (!url) return null;
  const malwareScanning = MALWARE_SCANNING === 'on';
  files ??= createFiles({
    db: getDb(),
    workspaces: getWorkspaces(),
    audit: createAudit(getDb()),
    // The identity's client id comes from AZURE_CLIENT_ID, which DefaultAzureCredential reads itself.
    blobs: createBlobStore({ url }),
    malwareScanning,
  });
  return { files, malwareScanning };
}
