import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { BlobServiceClient, StorageSharedKeyCredential } from '@azure/storage-blob';
import { AzuriteContainer, type StartedAzuriteContainer } from '@testcontainers/azurite';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { createAudit } from '@credalent/audit/composition';
import { createDb, DbQueryError, withCandidateAccount, withWorkspace, type Db, type Tx } from '@credalent/db';
import { FileError, type FilesContract, type Purpose } from '@credalent/files';
import { createBlobStore, createFiles, type BlobStore } from '@credalent/files/composition';
import { fileStore } from '../../../modules/files/src/infrastructure/repository.ts';
import { ForbiddenError, type WorkspaceContext, type WorkspacesContract } from '@credalent/workspaces';
import { createWorkspaces } from '@credalent/workspaces/composition';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// AIV-P0-016 acceptance scenarios against real PostgreSQL (as the non-owner aivera_app role) and Azurite. Azurite
// signs with its well-known account key (a service SAS); Azure signs with a user delegation key, same scope and expiry.
// Synthetic files only.

const rolesSql = readFileSync(createRequire(import.meta.url).resolve('@credalent/db/sql/roles.sql'), 'utf8');
const dbCli = join(import.meta.dirname, '..', '..', '..', 'packages', 'db', 'src', 'cli.ts');

const ALEX = '0190d4a2-0000-7000-8000-00000000a1e1';
const OMAR = '0190d4a2-0000-7000-8000-00000000a1e2';
const LINA = '0190d4a2-0000-7000-8000-0000000011aa';
const ACCOUNT_A = '0190d4a2-0000-7000-8000-0000000ca0a1';
const ACCOUNT_B = '0190d4a2-0000-7000-8000-0000000ca0b2';
const MB = 1024 * 1024;
const PDF = 'application/pdf';

let pg: StartedPostgreSqlContainer;
let azurite: StartedAzuriteContainer;
let admin: Db;
let app: Db;
let workspaces: WorkspacesContract;
let blobs: BlobStore;
let storage: BlobServiceClient;
let files: FilesContract;
let w1: string;
let w2: string;

const urlFor = (role: string) =>
  `postgres://${role}:local_dev_only@${pg.getHost()}:${pg.getPort()}/${pg.getDatabase()}`;
const as = <T>(userId: string, workspaceId: string, fn: (ctx: WorkspaceContext) => Promise<T>) =>
  workspaces.withWorkspace({ userId }, workspaceId, fn);
const filesWith = (malwareScanning: boolean, now?: () => Date) =>
  createFiles({ db: app, workspaces, audit: createAudit(app), blobs, malwareScanning, ...(now && { now }) });

/** A synthetic PDF of `size` bytes. */
const pdfOf = (size: number) => Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(size - 9, 0x20)]);
/** The browser's PUT with the returned SAS URL (useDirectUpload). */
const put = (url: string, body: Buffer, contentType = PDF) =>
  fetch(url, {
    method: 'PUT',
    body: new Uint8Array(body),
    headers: { 'x-ms-blob-type': 'BlockBlob', 'x-ms-blob-content-type': contentType },
  });

async function upload(workspaceId: string, purpose: Purpose, body: Buffer, contract = files) {
  const ticket = await as(workspaceId === w1 ? ALEX : OMAR, workspaceId, (ctx) =>
    contract.requestUpload(ctx, { purpose, fileName: 'eval-set-sample.pdf', contentType: PDF, size: body.length }),
  );
  expect((await put(ticket.uploadUrl, body)).status).toBe(201);
  return { ...ticket, blobUri: ticket.uploadUrl.split('?')[0] ?? '' };
}
const scanResult = (blobUri: string, scanResultType: string) => ({
  id: crypto.randomUUID(),
  eventType: 'Microsoft.Security.MalwareScanningResult',
  subject: 'storageAccounts/devstoreaccount1',
  eventTime: new Date().toISOString(),
  dataVersion: '1.0',
  data: { correlationId: crypto.randomUUID(), blobUri, scanResultType, scanResultDetails: { malwareNamesFound: [] } },
});
const exists = (path: string) => {
  const slash = path.indexOf('/');
  return storage
    .getContainerClient(path.slice(0, slash))
    .getBlobClient(path.slice(slash + 1))
    .exists();
};
const row = (workspaceId: string, id: string) =>
  withWorkspace(app, workspaceId, async (tx) => {
    const [found] = await tx.execute<{ status: string; blob_path: string; sha256: string | null }>(
      sql`select status, blob_path, sha256 from files.file where id = ${id}`,
    );
    return found;
  });
const outbox = (workspaceId: string, fileId: string) =>
  withWorkspace(app, workspaceId, async (tx) => [
    ...(await tx.execute<{ type: string; payload: unknown }>(
      sql`select type, payload from files.outbox where payload->>'fileId' = ${fileId}`,
    )),
  ]);

beforeAll(async () => {
  [pg, azurite] = await Promise.all([
    new PostgreSqlContainer('pgvector/pgvector:pg17').withDatabase('aivera').start(),
    new AzuriteContainer('mcr.microsoft.com/azure-storage/azurite:3.35.0')
      .withInMemoryPersistence()
      .withSkipApiVersionCheck()
      .start(),
  ]);
  admin = createDb(pg.getConnectionUri(), { max: 1 });
  await admin.$client.unsafe(rolesSql);
  execFileSync(process.execPath, [dbCli, 'migrate'], {
    env: { ...process.env, DATABASE_MIGRATOR_URL: urlFor('aivera_migrator') },
  });
  app = createDb(urlFor('aivera_app'), { max: 2 });
  workspaces = createWorkspaces(app, createAudit(app));
  const sharedKey = new StorageSharedKeyCredential(azurite.getAccountName(), azurite.getAccountKey());
  storage = new BlobServiceClient(azurite.getBlobEndpoint(), sharedKey);
  // In Azure the containers are infra/modules/storage.bicep's.
  for (const name of ['uploads-quarantine', 'cvs', 'evidence']) await storage.createContainer(name);
  blobs = createBlobStore({ url: azurite.getBlobEndpoint(), sharedKey });
  files = filesWith(true);
  const create = (name: string, creatorUserId: string) =>
    workspaces.createWorkspace({ name, company: name, hiringFocus: 'AI', synthetic: true, creatorUserId });
  w1 = (await create('Demo hiring team', ALEX)).id;
  w2 = (await create('Gulf Talent Partners', OMAR)).id;
  await withWorkspace(app, w1, (tx) =>
    tx.execute(sql`insert into workspaces.member (workspace_id, user_id, role, status)
      values (${w1}, ${LINA}, 'interviewer', 'active')`),
  );
});

afterAll(async () => {
  await app?.$client.end();
  await admin?.$client.end();
  await Promise.all([pg?.stop(), azurite?.stop()]);
});

describe('Scenario: A clean PDF is uploaded and becomes usable', () => {
  it('"eval-set-sample.pdf" (2 MB, portal), uploaded with the SAS and scanned "No threats found", is clean in "evidence"', async () => {
    const body = pdfOf(2 * MB);
    const { fileId, blobUri } = await upload(w1, 'portal', body);
    expect(await as(ALEX, w1, (ctx) => files.getStatus(ctx, fileId))).toBe('pending');

    await files.handleScanResult(scanResult(blobUri, 'No threats found'));

    expect(await as(ALEX, w1, (ctx) => files.getStatus(ctx, fileId))).toBe('clean');
    const stored = await row(w1, fileId);
    expect(stored).toMatchObject({ status: 'clean', blob_path: `evidence/w/${w1}/${fileId}` });
    expect(stored?.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect([await exists(`evidence/w/${w1}/${fileId}`), await exists(`uploads-quarantine/w/${w1}/${fileId}`)]).toEqual([
      true,
      false,
    ]);
    expect(await outbox(w1, fileId)).toEqual([{ type: 'FileClean.v1', payload: { fileId } }]);

    // A redelivered result changes nothing and publishes nothing more.
    await files.handleScanResult(scanResult(blobUri, 'Malicious'));
    expect([(await row(w1, fileId))?.status, (await outbox(w1, fileId)).length]).toEqual(['clean', 1]);

    const link = await as(ALEX, w1, (ctx) => files.issueReadLink(ctx, fileId));
    const download = await fetch(link?.url ?? '');
    expect(download.headers.get('content-type')).toBe(PDF);
    expect(Buffer.from(await download.arrayBuffer()).equals(body)).toBe(true);
  });
});

describe('Scenario: An infected file never becomes evidence', () => {
  // SAFETY: mutation check: issueReadLink with `if (!file) return null` in place of `file?.status !== 'clean'` -> this test failed (a link to the infected file)
  it('reported "Malicious": deleted from quarantine, "infected", never downloadable, and file.rejected is published', async () => {
    const { fileId, blobUri } = await upload(w1, 'evidence', pdfOf(4096));
    await files.handleScanResult(scanResult(blobUri, 'Malicious'));

    expect(await as(ALEX, w1, (ctx) => files.getStatus(ctx, fileId))).toBe('infected');
    expect(await exists(`uploads-quarantine/w/${w1}/${fileId}`)).toBe(false);
    expect(await exists(`evidence/w/${w1}/${fileId}`)).toBe(false);
    expect(await outbox(w1, fileId)).toEqual([{ type: 'FileRejected.v1', payload: { fileId, reason: 'infected' } }]);
    expect(await as(ALEX, w1, (ctx) => files.issueReadLink(ctx, fileId))).toBeNull();
  });

  it('a pending file is not downloadable either', async () => {
    const { fileId } = await upload(w1, 'evidence', pdfOf(4096));
    expect(await as(ALEX, w1, (ctx) => files.issueReadLink(ctx, fileId))).toBeNull();
  });

  it('a scan result that is neither verdict is retried; one for a blob outside quarantine is ignored', async () => {
    const { fileId, blobUri } = await upload(w1, 'evidence', pdfOf(4096));
    await expect(files.handleScanResult(scanResult(blobUri, 'Error'))).rejects.toThrow('neither clean nor malicious');
    // Defender also scans the moved copy: nothing to do, and nothing to dead-letter.
    await files.handleScanResult(scanResult(blobUri.replace('uploads-quarantine', 'evidence'), 'Malicious'));
    await expect(files.handleScanResult({ eventType: 'Microsoft.Storage.BlobCreated' })).rejects.toMatchObject({
      name: 'ZodError',
    });
    expect((await row(w1, fileId))?.status).toBe('pending');
  });

  // A transaction holds the row while a clean result arrives, then settles the file infected: the handler must wait for
  // it and leave the infected file alone, never overwrite it with clean.
  // SAFETY: mutation check: find without `.for('update')` in the repository -> this test failed (overwrote infected with clean)
  it('a scan result waits for a settle in progress, so a file is settled once', async () => {
    const { fileId, blobUri } = await upload(w1, 'evidence', pdfOf(4096));
    let handled: Promise<void> = Promise.resolve();
    await withWorkspace(app, w1, async (tx) => {
      await tx.execute(sql`select id from files.file where id = ${fileId} for update`);
      handled = files.handleScanResult(scanResult(blobUri, 'No threats found'));
      await new Promise((resolve) => setTimeout(resolve, 500));
      await tx.execute(sql`update files.file set status = 'infected' where id = ${fileId}`);
    });
    await handled;
    expect((await row(w1, fileId))?.status).toBe('infected');
    expect(await outbox(w1, fileId)).toEqual([]);
  });
});

/** An upload ticket from a clock set `minutes` back. */
const ticketIssuedAgo = (minutes: number) =>
  as(ALEX, w1, (ctx) =>
    filesWith(true, () => new Date(Date.now() - minutes * 60_000)).requestUpload(ctx, {
      purpose: 'evidence',
      fileName: 'eval-set-sample.pdf',
      contentType: PDF,
      size: 4096,
    }),
  );

describe('Scenario: The SAS cannot be reused for anything else', () => {
  it('reading that blob, or writing a different blob, with the SAS is refused with 403', async () => {
    const { uploadUrl } = await upload(w1, 'evidence', pdfOf(4096));
    expect((await fetch(uploadUrl)).status).toBe(403);
    const other = uploadUrl.replace(/\/[0-9a-f-]{36}\?/, `/${crypto.randomUUID()}?`);
    expect(other).not.toBe(uploadUrl);
    expect((await put(other, pdfOf(4096))).status).toBe(403);
    const sibling = uploadUrl.replace('/uploads-quarantine/', '/evidence/');
    expect((await put(sibling, pdfOf(4096))).status).toBe(403);
  });

  // SAFETY: mutation check: SAS permissions 'cw' instead of 'c' -> this test failed (the overwrite was accepted, 201)
  it('the SAS cannot overwrite the blob it created, so the scanned bytes are the bytes settled', async () => {
    const { uploadUrl } = await upload(w1, 'evidence', pdfOf(4096));
    expect((await put(uploadUrl, pdfOf(4096))).status).toBe(403);
  });

  // Issued with a clock set back, so the 10-minute expiry is tested without waiting (a minute's margin for clock skew).
  it('a SAS issued 11 minutes ago no longer works; one issued 9 minutes ago still does', async () => {
    expect((await put((await ticketIssuedAgo(11)).uploadUrl, pdfOf(4096))).status).toBe(403);
    expect((await put((await ticketIssuedAgo(9)).uploadUrl, pdfOf(4096))).status).toBe(201);
  });
});

describe('Malware scanning off (dev only)', () => {
  it('marks a CV clean once the browser reports it uploaded, re-checking the real blob first', async () => {
    const devFiles = filesWith(false);
    const { fileId } = await upload(w1, 'cv', pdfOf(4096), devFiles);
    expect(await as(ALEX, w1, (ctx) => devFiles.markCleanWithoutScan(ctx, fileId))).toBe('clean');
    expect(await exists(`cvs/w/${w1}/${fileId}`)).toBe(true);
    expect(await outbox(w1, fileId)).toEqual([{ type: 'FileClean.v1', payload: { fileId } }]);
  });

  it('rejects and deletes a blob bigger than the size asked for', async () => {
    const devFiles = filesWith(false);
    const ticket = await as(ALEX, w1, (ctx) =>
      devFiles.requestUpload(ctx, { purpose: 'cv', fileName: 'cv.pdf', contentType: PDF, size: 4096 }),
    );
    expect((await put(ticket.uploadUrl, pdfOf(30 * MB))).status).toBe(201);
    expect(await as(ALEX, w1, (ctx) => devFiles.markCleanWithoutScan(ctx, ticket.fileId))).toBe('rejected');
    expect(await exists(`uploads-quarantine/w/${w1}/${ticket.fileId}`)).toBe(false);
  });

  // SAFETY: mutation check: removed `if (p.malwareScanning) throw` from markCleanWithoutScan -> this test failed (resolved 'clean')
  it('is refused when scanning is on: the file stays pending in quarantine', async () => {
    const { fileId } = await upload(w1, 'cv', pdfOf(4096));
    await expect(as(ALEX, w1, (ctx) => files.markCleanWithoutScan(ctx, fileId))).rejects.toEqual(
      new FileError('scanning_required'),
    );
    expect((await row(w1, fileId))?.status).toBe('pending');
    expect(await exists(`uploads-quarantine/w/${w1}/${fileId}`)).toBe(true);
  });
});

describe('Size and type limits before upload', () => {
  it('an 11 MB CV is refused with its message, and nothing is recorded', async () => {
    await expect(
      as(ALEX, w1, (ctx) =>
        files.requestUpload(ctx, { purpose: 'cv', fileName: 'cv.pdf', contentType: PDF, size: 11 * MB }),
      ),
    ).rejects.toEqual(new FileError('limits.cv'));
  });
});

describe('Scenario: Files from another workspace cannot be downloaded', () => {
  it("a W1 recruiter asking for W2's clean file gets nothing; W2's own admin gets it", async () => {
    const { fileId, blobUri } = await upload(w2, 'evidence', pdfOf(4096));
    await files.handleScanResult(scanResult(blobUri, 'No threats found'));
    expect(await as(ALEX, w1, (ctx) => files.issueReadLink(ctx, fileId))).toBeNull();
    expect(await as(ALEX, w1, (ctx) => files.getStatus(ctx, fileId))).toBeNull();
    expect(await as(OMAR, w2, (ctx) => files.issueReadLink(ctx, fileId))).not.toBeNull();
  });
});

const linkEntries = async (fileId: string) =>
  (await createAudit(app).listFor(w1, { type: 'file', id: fileId })).filter((e) => e.action === 'file.link_issued');
const cleanFile = async (workspaceId = w1) => {
  const { fileId, blobUri } = await upload(workspaceId, 'evidence', pdfOf(4096));
  await files.handleScanResult(scanResult(blobUri, 'No threats found'));
  return fileId;
};

describe('Scenario: Opening an uploaded file (AIV-P1-045)', () => {
  it('a recruiter gets a link that reads that one file as an attachment for 5 minutes, and the access is audited', async () => {
    const fileId = await cleanFile();
    const before = Date.now();
    const link = await as(ALEX, w1, (ctx) => files.issueReadLink(ctx, fileId));
    if (!link) throw new Error('no link');
    expect(link.expiresAt.getTime() - before).toBeGreaterThanOrEqual(5 * 60_000 - 1000);
    expect(link.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(5 * 60_000);
    // The signature itself ends then (`se`), to the second.
    expect(new URL(link.url).searchParams.get('se')).toBe(link.expiresAt.toISOString().replace(/\.\d{3}Z$/, 'Z'));
    const response = await fetch(link.url);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-disposition')).toBe('attachment');
    expect(response.headers.get('content-type')).toBe(PDF);
    expect((await response.arrayBuffer()).byteLength).toBe(4096);
    // Read only: the same signature cannot overwrite or delete the blob.
    expect((await put(link.url, pdfOf(16))).status).toBe(403);
    expect((await fetch(link.url, { method: 'DELETE' })).status).toBe(403);
    const entries = await linkEntries(fileId);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ actor: { type: 'user', id: ALEX }, subject: { type: 'file', id: fileId } });
  });

  it('the link stops working once its 5 minutes have passed', async () => {
    const fileId = await cleanFile();
    const sixMinutesAgo = filesWith(true, () => new Date(Date.now() - 6 * 60_000));
    const link = await as(ALEX, w1, (ctx) => sixMinutesAgo.issueReadLink(ctx, fileId));
    expect((await fetch(link?.url ?? '')).status).toBe(403);
  });

  // SAFETY: mutation check: removed `await p.authorize(ctx, 'file.download')` from issueReadLink -> this test failed (the interviewer got a link)
  it('Scenario: Interviewer not on the job: an interviewer is refused and nothing is audited', async () => {
    const fileId = await cleanFile();
    await expect(as(LINA, w1, (ctx) => files.issueReadLink(ctx, fileId))).rejects.toBeInstanceOf(ForbiddenError);
    expect(await linkEntries(fileId)).toEqual([]);
  });

  it("another workspace's file, and a file not yet clean, get no link and no audit entry", async () => {
    const theirs = await cleanFile(w2);
    expect(await as(ALEX, w1, (ctx) => files.issueReadLink(ctx, theirs))).toBeNull();
    const { fileId: pending } = await upload(w1, 'evidence', pdfOf(4096));
    expect(await as(ALEX, w1, (ctx) => files.issueReadLink(ctx, pending))).toBeNull();
    expect([...(await linkEntries(theirs)), ...(await linkEntries(pending))]).toEqual([]);
  });
});

const accountFile = (id: string, account: string) =>
  withCandidateAccount(app, account, (tx) =>
    tx.execute(sql`insert into files.file (id, candidate_account_id, purpose, content_type, size_bytes, status,
      blob_path, uploaded_by, created_at)
      values (${id}, ${account}, 'cv', ${PDF}, 10, 'pending', ${`uploads-quarantine/c/${account}/${id}`},
        ${account}, now())`),
  );
const ids = async (scope: (work: (tx: Tx) => Promise<{ id: string }[]>) => Promise<{ id: string }[]>) =>
  (await scope(async (tx) => [...(await tx.execute<{ id: string }>(sql`select id from files.file`))])).map((r) => r.id);
// As the superuser, which row-level security skips, so only the check constraint can refuse.
const insertOwnedBy = (workspaceId: string | null, account: string | null) =>
  admin
    .execute(
      sql`insert into files.file (id, workspace_id, candidate_account_id, purpose, content_type,
      size_bytes, status, blob_path, uploaded_by, created_at)
      values (${crypto.randomUUID()}, ${workspaceId}, ${account}, 'cv', ${PDF}, 10, 'pending', 'x/y', ${ALEX}, now())`,
    )
    .then(
      () => 'inserted',
      (error: unknown) => (error instanceof DbQueryError ? error.code : String(error)),
    );

describe('Row-level security on files.file (ADR-005, ADR-009)', () => {
  it("a candidate account's upload is seen in that account's scope only, never in a workspace's or another account's", async () => {
    const id = crypto.randomUUID();
    await accountFile(id, ACCOUNT_A);
    expect(await ids((work) => withCandidateAccount(app, ACCOUNT_A, work))).toEqual([id]);
    expect(await ids((work) => withCandidateAccount(app, ACCOUNT_B, work))).toEqual([]);
    expect(await ids((work) => withWorkspace(app, w1, work))).not.toContain(id);
  });

  it('a row with both a workspace and an account, or neither, is refused', async () => {
    expect(await insertOwnedBy(w1, ACCOUNT_A)).toBe('23514');
    expect(await insertOwnedBy(null, null)).toBe('23514');
  });
});

// AIV-P2-061: the store's settle filters by owner, under row-level security; each layer alone keeps B's file as it is.
describe('Scenario: settle respects the owner', () => {
  // SAFETY: mutation check: settle without `ownedBy(owner)` (id only) -> this test failed (the admin connection set B's file infected)
  it("workspace A settling workspace B's file changes nothing", async () => {
    const { fileId } = await upload(w2, 'evidence', pdfOf(4096));
    const infected = { status: 'infected' } as const;
    // The owner filter alone: the test's superuser connection bypasses row-level security.
    await admin.transaction((tx) => fileStore(tx).settle({ workspaceId: w1 }, fileId, infected));
    expect((await row(w2, fileId))?.status).toBe('pending');
    // Row-level security alone: A's scope, with the filter naming B.
    await withWorkspace(app, w1, (tx) => fileStore(tx).settle({ workspaceId: w2 }, fileId, infected));
    expect((await row(w2, fileId))?.status).toBe('pending');
    // Control: B's own scope settles it.
    await withWorkspace(app, w2, (tx) => fileStore(tx).settle({ workspaceId: w2 }, fileId, infected));
    expect((await row(w2, fileId))?.status).toBe('infected');
  });
});
