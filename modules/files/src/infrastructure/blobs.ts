import { Readable } from 'node:stream';
import { DefaultAzureCredential } from '@azure/identity';
import {
  BlobSASPermissions,
  BlobServiceClient,
  generateBlobSASQueryParameters,
  SASProtocol,
  StorageSharedKeyCredential,
} from '@azure/storage-blob';
import type { BlobStore } from '../application/files.ts';
import { UPLOAD_TTL_MS } from '../domain/files.ts';

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

  return {
    async uploadUrl(path, expiresOn) {
      const target = blob(path);
      const values = {
        containerName: target.containerName,
        blobName: target.name,
        // Create that one blob, once: no read, list, delete, overwrite or any other blob (the Gherkin's 403s). One Put
        // Blob of up to 5000 MiB needs nothing more.
        permissions: BlobSASPermissions.parse('c'),
        expiresOn,
        protocol: url.startsWith('https:') ? SASProtocol.Https : SASProtocol.HttpsAndHttp,
      };
      const sas = sharedKey
        ? generateBlobSASQueryParameters(values, sharedKey)
        : generateBlobSASQueryParameters(
            values,
            // shortcut: one delegation key per upload request; cache it for its lifetime if uploads get frequent
            // Valid from a minute before the SAS's start (clock skew), derived from its expiry, not a clock read here.
            await service.getUserDelegationKey(new Date(expiresOn.getTime() - UPLOAD_TTL_MS - 60_000), expiresOn),
            service.accountName,
          );
      return `${target.url}?${sas.toString()}`;
    },
    async read(path, maxBytes) {
      const target = blob(path);
      if (!(await target.exists())) return null;
      const { contentLength: size = 0, contentType } = await target.getProperties();
      return { size, contentType, data: size <= maxBytes ? await target.downloadToBuffer() : null };
    },
    write: async (path, data, contentType) =>
      void (await blob(path).uploadData(data, { blobHTTPHeaders: { blobContentType: contentType } })),
    delete: async (path) => void (await blob(path).deleteIfExists()),
    async stream(path) {
      const body = (await blob(path).download()).readableStreamBody;
      if (!body) throw new Error('blob download returned no body');
      return Readable.toWeb(body as Readable) as ReadableStream<Uint8Array>;
    },
  };
}
