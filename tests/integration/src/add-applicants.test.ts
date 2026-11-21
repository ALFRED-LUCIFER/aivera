import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { BlobServiceClient, StorageSharedKeyCredential } from '@azure/storage-blob';
import { AzuriteContainer, type StartedAzuriteContainer } from '@testcontainers/azurite';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { createAudit } from '@credalent/audit/composition';
import { createCandidates, displayNamesInWorkspace } from '@credalent/candidates/composition';
import { createDb, withWorkspace, type Db } from '@credalent/db';
import type { FilesContract } from '@credalent/files';
import { createBlobStore, createFiles, type BlobStore } from '@credalent/files/composition';
import { IntakeError, type IntakeContract, type Source } from '@credalent/intake';
import { createIntake } from '@credalent/intake/composition';
import type { JobsContract } from '@credalent/jobs';
import { createJobs } from '@credalent/jobs/composition';
import { ForbiddenError, type WorkspaceContext, type WorkspacesContract } from '@credalent/workspaces';
import { createWorkspaces } from '@credalent/workspaces/composition';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// AIV-P1-019 "Add applicants" against real PostgreSQL (as the non-owner aivera_app role) and Azurite. Keep `addApplicants`
// below in step with linkCleanCvs.ts: a test package may not import the app (AGENTS.md 9.4). The steps are the
// web action's (apps/web/src/features/add-applicants/services/linkCleanCvs.ts, whose unit test covers its refusal
// branch): the browser uploads each CV and waits for clean; the server re-reads each file with findCleanUpload and
// files a clean CV through receiveApplication, the person known by the CV's hash. Synthetic files and cast only.

const rolesSql = readFileSync(createRequire(import.meta.url).resolve('@credalent/db/sql/roles.sql'), 'utf8');
const dbCli = join(import.meta.dirname, '..', '..', '..', 'packages', 'db', 'src', 'cli.ts');

const ALEX = '0190d4a2-0000-7000-8000-00000000a1e1';
const SARA = '0190d4a2-0000-7000-8000-00000000a1e3';
const LINA = '0190d4a2-0000-7000-8000-0000000011aa';
const OMAR = '0190d4a2-0000-7000-8000-00000000a1e2';
const PDF = 'application/pdf';
const NOW = new Date('2026-11-20T09:00:00.000Z');

let pg: StartedPostgreSqlContainer;
let azurite: StartedAzuriteContainer;
let admin: Db;
let app: Db;
let workspaces: WorkspacesContract;
let blobs: BlobStore;
let files: FilesContract;
let scanned: FilesContract;
let jobs: JobsContract;
let intake: IntakeContract;
let w1: string;
let w2: string;
let jobId: string;
let w2JobId: string;

const urlFor = (role: string) =>
  `postgres://${role}:local_dev_only@${pg.getHost()}:${pg.getPort()}/${pg.getDatabase()}`;
const as = <T>(userId: string, fn: (ctx: WorkspaceContext) => Promise<T>, workspaceId = w1) =>
  workspaces.withWorkspace({ userId }, workspaceId, fn);

/** A synthetic CV whose bytes, and so whose hash, depend on `n`. */
const cvOf = (n: number) => Buffer.from(`%PDF-1.7\nsynthetic CV ${n}\n`);

/** The browser's part (useDirectUpload): ask, PUT with the SAS URL; with scanning off, settle it at once. */
async function upload(
  body: Buffer,
  settle: 'clean' | 'pending' = 'clean',
  userId = ALEX,
  contract = files,
  workspaceId = w1,
) {
  const ticket = await as(
    userId,
    (ctx) => contract.requestUpload(ctx, { purpose: 'cv', fileName: 'cv.pdf', contentType: PDF, size: body.length }),
    workspaceId,
  );
  const put = await fetch(ticket.uploadUrl, {
    method: 'PUT',
    body: new Uint8Array(body),
    headers: { 'x-ms-blob-type': 'BlockBlob', 'x-ms-blob-content-type': PDF },
  });
  expect(put.status).toBe(201);
  if (settle === 'clean')
    expect(await as(userId, (ctx) => contract.markCleanWithoutScan(ctx, ticket.fileId), workspaceId)).toBe('clean');
  return { fileId: ticket.fileId, blobUri: ticket.uploadUrl.split('?')[0] ?? '' };
}

/** The server action's steps, in its order: every file re-read and refused unless clean, then each one filed. */
const addApplicants = (userId: string, source: Source, fileIds: string[], job = () => jobId) =>
  as(userId, async (ctx) => {
    const cvs = [];
    for (const fileId of fileIds) {
      const clean = await files.findCleanUpload(ctx, fileId);
      if (clean?.purpose !== 'cv') return null;
      cvs.push({ fileId, sha256: clean.sha256 });
    }
    const results = [];
    for (const cv of cvs)
      results.push(
        await intake.receiveApplication(ctx, {
          jobId: job(),
          person: {
            displayName: 'Unnamed applicant',
            identifiers: [{ type: 'cv_hash', value: cv.sha256 }],
            synthetic: true,
          },
          source,
          fileIds: [cv.fileId],
        }),
      );
    return results;
  });

/** Defender's verdict on a quarantined upload, as Event Grid delivers it. */
const scan = (blobUri: string, scanResultType: 'No threats found' | 'Malicious') =>
  scanned.handleScanResult({
    id: crypto.randomUUID(),
    eventType: 'Microsoft.Security.MalwareScanningResult',
    subject: 'storageAccounts/devstoreaccount1',
    eventTime: NOW.toISOString(),
    dataVersion: '1.0',
    data: { correlationId: crypto.randomUUID(), blobUri, scanResultType, scanResultDetails: { malwareNamesFound: [] } },
  });

const sourcesOf = (applicationId: string) =>
  withWorkspace(app, w1, async (tx) => [
    ...(await tx.execute<{ source: string; file_ids: string[] }>(
      sql`select source, file_ids from intake.application_source where application_id = ${applicationId} order by received_at, id`,
    )),
  ]);
const count = async (table: string) =>
  Number((await admin.execute<{ n: string }>(sql`select count(*) as n from ${sql.raw(table)}`))[0]?.n);

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
  const audit = createAudit(app);
  workspaces = createWorkspaces(app, audit);
  const sharedKey = new StorageSharedKeyCredential(azurite.getAccountName(), azurite.getAccountKey());
  const storage = new BlobServiceClient(azurite.getBlobEndpoint(), sharedKey);
  for (const name of ['uploads-quarantine', 'cvs', 'evidence']) await storage.createContainer(name);
  blobs = createBlobStore({ url: azurite.getBlobEndpoint(), sharedKey });
  // Dev (scanning off) settles at upload; the pilot (scanning on) waits for Defender's result.
  files = createFiles({ db: app, workspaces, blobs, malwareScanning: false });
  scanned = createFiles({ db: app, workspaces, blobs, malwareScanning: true });
  jobs = createJobs(workspaces, audit, () => NOW);
  intake = createIntake(
    workspaces,
    createCandidates(workspaces, () => NOW),
    jobs,
    displayNamesInWorkspace,
    () => NOW,
  );
  w1 = (
    await workspaces.createWorkspace({
      name: 'Demo Hiring Co',
      company: 'Demo Hiring Co',
      hiringFocus: 'AI',
      synthetic: true,
      creatorUserId: ALEX,
    })
  ).id;
  w2 = (
    await workspaces.createWorkspace({
      name: 'Harbour Talent',
      company: 'Harbour Talent',
      hiringFocus: 'AI',
      synthetic: true,
      creatorUserId: OMAR,
    })
  ).id;
  w2JobId = (
    await as(
      OMAR,
      (ctx) =>
        jobs.createJob(ctx, {
          title: 'Staff Backend Engineer',
          jobType: 'ai_llm_engineering',
          description: 'Staff Backend Engineer, synthetic.',
          synthetic: true,
        }),
      w2,
    )
  ).id;
  await withWorkspace(app, w1, (tx) =>
    tx.execute(sql`insert into workspaces.member (workspace_id, user_id, role, status)
      values (${w1}, ${LINA}, 'interviewer', 'active'), (${w1}, ${SARA}, 'recruiter', 'active')`),
  );
  jobId = (
    await as(ALEX, (ctx) =>
      jobs.createJob(ctx, {
        title: 'Staff Backend Engineer',
        jobType: 'ai_llm_engineering',
        description: 'Staff Backend Engineer, synthetic.',
        synthetic: true,
      }),
    )
  ).id;
});

afterAll(async () => {
  await app?.$client.end();
  await admin?.$client.end();
  await Promise.all([pg?.stop(), azurite?.stop()]);
});

describe('Scenario: Manual upload with a source', () => {
  it('3 CVs added to Staff Backend Engineer with source LinkedIn are 3 applications from LinkedIn', async () => {
    const uploaded = [await upload(cvOf(1)), await upload(cvOf(2)), await upload(cvOf(3))];
    const results = await addApplicants(
      ALEX,
      'linkedin',
      uploaded.map((u) => u.fileId),
    );
    expect(results?.map((r) => r.created)).toEqual([true, true, true]);
    for (const [i, r] of (results ?? []).entries())
      expect(await sourcesOf(r.applicationId)).toEqual([{ source: 'linkedin', file_ids: [uploaded[i]?.fileId] }]);

    // CV-only applicants: unnamed until parsing (AIV-P1-025), known by the CV's hash, synthetic as the workspace is.
    const people = await withWorkspace(app, w1, async (tx) => [
      ...(await tx.execute<{ display_name: string; synthetic: boolean; type: string }>(sql`
        select p.display_name, p.synthetic, i.type from candidates.person p
        join candidates.person_identifier i on i.person_id = p.id
        where p.id in (select person_id from intake.application where id in (${sql.join(
          (results ?? []).map((r) => sql`${r.applicationId}`),
          sql`, `,
        )}))`)),
    ]);
    expect(people).toEqual(
      Array.from({ length: 3 }, () => ({ display_name: 'Unnamed applicant', synthetic: true, type: 'cv_hash' })),
    );
  });

  it('the same CV uploaded twice to the job is one application with two sources', async () => {
    const [first] = (await addApplicants(ALEX, 'referral', [(await upload(cvOf(4))).fileId])) ?? [];
    const again = await upload(cvOf(4));
    const [second] = (await addApplicants(ALEX, 'email', [again.fileId])) ?? [];
    expect(second).toMatchObject({ applicationId: first?.applicationId, created: false });
    expect((await sourcesOf(first?.applicationId ?? '')).map((s) => s.source)).toEqual(['referral', 'email']);
  });
});

describe('Scenario: Only clean files are linked to an application source', () => {
  // SAFETY: mutation check: findCleanUpload without its `status !== 'clean'` and hash checks -> this test failed (the pending file was filed)
  it('a file still pending its scan, or infected, is refused and nothing is filed', async () => {
    const before = [await count('intake.application'), await count('intake.application_source')];
    const pending = await upload(cvOf(5), 'pending', ALEX, scanned);
    const infected = await upload(cvOf(6), 'pending', ALEX, scanned);
    await scan(infected.blobUri, 'Malicious');
    expect(await as(ALEX, (ctx) => files.getStatus(ctx, infected.fileId))).toBe('infected');

    const clean = await upload(cvOf(7));
    expect(await addApplicants(ALEX, 'linkedin', [clean.fileId, pending.fileId])).toBeNull();
    expect(await addApplicants(ALEX, 'linkedin', [clean.fileId, infected.fileId])).toBeNull();
    expect([await count('intake.application'), await count('intake.application_source')]).toEqual(before);

    // Once the scan reports it clean, the same file is linked.
    await scan(pending.blobUri, 'No threats found');
    const [filed] = (await addApplicants(ALEX, 'linkedin', [pending.fileId])) ?? [];
    expect(await sourcesOf(filed?.applicationId ?? '')).toEqual([{ source: 'linkedin', file_ids: [pending.fileId] }]);
  });

  it("another member's clean upload is not offered for linking", async () => {
    const saras = await upload(cvOf(8), 'clean', SARA);
    expect(await as(SARA, (ctx) => files.findCleanUpload(ctx, saras.fileId))).toMatchObject({ purpose: 'cv' });
    expect(await as(ALEX, (ctx) => files.findCleanUpload(ctx, saras.fileId))).toBeNull();
  });
});

describe('Scenario: Only recruiters upload', () => {
  // SAFETY: mutation check: findCleanUpload without `p.authorize(ctx, 'file.upload')` -> this test failed (resolved null instead of 403). The action's own candidate.create gate: apps/web addApplicants.test.ts.
  it('an interviewer is refused (403) before any file is read or anything is filed', async () => {
    const { fileId } = await upload(cvOf(9));
    await expect(as(LINA, (ctx) => files.findCleanUpload(ctx, fileId))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(addApplicants(LINA, 'linkedin', [fileId])).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("Scenario: Another workspace's job or file is refused", () => {
  // SAFETY: mutation check: intake receiveApplication without its jobExists check -> this test failed (an application was written for the other workspace's job)
  it("another workspace's job is refused and nothing is written", async () => {
    const before = [await count('candidates.person'), await count('intake.application')];
    const { fileId } = await upload(cvOf(10));
    await expect(addApplicants(ALEX, 'linkedin', [fileId], () => w2JobId)).rejects.toBeInstanceOf(IntakeError);
    expect([await count('candidates.person'), await count('intake.application')]).toEqual(before);
  });

  // SAFETY: mutation check: ALTER POLICY file_tenant_isolation ON files.file USING (true) -> this test failed (the unfiltered read saw the other workspace's file)
  it("another workspace's clean file is refused, and row-level security hides it even with no workspace filter", async () => {
    const theirs = await upload(cvOf(11), 'clean', OMAR, files, w2);
    expect(await addApplicants(ALEX, 'linkedin', [theirs.fileId])).toBeNull();
    const seen = await withWorkspace(app, w1, (tx) =>
      tx.execute(sql`select id from files.file where id = ${theirs.fileId}`),
    );
    expect([...seen]).toEqual([]);
  });
});
