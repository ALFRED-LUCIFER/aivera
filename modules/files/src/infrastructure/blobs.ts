import { DefaultAzureCredential } from '@azure/identity';
import {
  BlobSASPermissions,
  BlobServiceClient,
  generateBlobSASQueryParameters,
  SASProtocol,
  StorageSharedKeyCredential,
} from '@azure/storage-blob';
import type { BlobStore } from '../application/files.ts';
import { READ_LINK_TTL_MS, UPLOAD_TTL_MS } from '../domain/files.ts';

export type BlobStoreConfig = {
  /** The account's blob endpoint, `https://<account>.blob.core.windows.net`. */
  url: string;
  /** The managed identity's client id (Azure); the account has shared keys off, so SAS are user-delegation SAS. */
  clientId?: string | undefined;
  /** Tests against Azurite only: Azurite signs with its well-known account key (a service SAS, same scope). */
  sharedKey?: StorageSharedKeyCredential;
};

/** Blob storage through `@azure/storage-blob`, signed in with the app identity (infra/modules/storage.bicep). */
export function createBlobStore({ url, clientId, sharedKey }: BlobStoreConfig): BlobStore {
  const service = new BlobServiceClient(
    url,
    sharedKey ?? new DefaultAzureCredential(clientId ? { managedIdentityClientId: clientId } : {}),
  );
  const blob = (path: string) => {
    const slash = path.indexOf('/');
    return service.getContainerClient(path.slice(0, slash)).getBlockBlobClient(path.slice(slash + 1));
  };

  /** A SAS URL for the one blob at `path`: a service SAS under Azurite's key, a user-delegation SAS in Azure. */
  async function sasUrl(
    path: string,
    expiresOn: Date,
    ttlMs: number,
    grant: { permissions: BlobSASPermissions; contentDisposition?: string; contentType?: string },
  ) {
    const target = blob(path);
    const values = {
      containerName: target.containerName,
      blobName: target.name,
      ...grant,
      expiresOn,
      protocol: url.startsWith('https:') ? SASProtocol.Https : SASProtocol.HttpsAndHttp,
    };
    const sas = sharedKey
      ? generateBlobSASQueryParameters(values, sharedKey)
      : generateBlobSASQueryParameters(
          values,
          // shortcut: one delegation key per link; cache it for its lifetime if uploads or reads get frequent
          // Valid from a minute before the SAS's start (clock skew), derived from its expiry, not a clock read here.
          await service.getUserDelegationKey(new Date(expiresOn.getTime() - ttlMs - 60_000), expiresOn),
          service.accountName,
        );
    return `${target.url}?${sas.toString()}`;
  }

  return {
    // Create that one blob, once: no read, list, delete, overwrite or any other blob (the Gherkin's 403s). One Put
    // Blob of up to 5000 MiB needs nothing more.
    uploadUrl: (path, expiresOn) =>
      sasUrl(path, expiresOn, UPLOAD_TTL_MS, { permissions: BlobSASPermissions.parse('c') }),
    // Read that one blob: no write, list, delete or any other blob. Saved, never rendered, and no name (it can name
    // the candidate), as the download route answers.
    readUrl: (path, expiresOn, contentType) =>
      sasUrl(path, expiresOn, READ_LINK_TTL_MS, {
        permissions: BlobSASPermissions.parse('r'),
        contentDisposition: 'attachment',
        contentType,
      }),
    async read(path, maxBytes) {
      const target = blob(path);
      if (!(await target.exists())) return null;
      const { contentLength: size = 0, contentType } = await target.getProperties();
      return { size, contentType, data: size <= maxBytes ? await target.downloadToBuffer() : null };
    },
    write: async (path, data, contentType) =>
      void (await blob(path).uploadData(data, { blobHTTPHeaders: { blobContentType: contentType } })),
    delete: async (path) => void (await blob(path).deleteIfExists()),
  };
}
