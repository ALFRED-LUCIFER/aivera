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
import { createConsumer, type Delivery } from '@credalent/db/consumer';
import type { FilesContract } from '@credalent/files';
import {
  createBlobStore,
  createCleanFileReader,
  createCvLinkFetcher,
  createFiles,
  type BlobStore,
  type Resolve,
} from '@credalent/files/composition';
import { IntakeError, type IntakeContract, type SheetImportView } from '@credalent/intake';
import { createIntake, createSheetImportHandler } from '@credalent/intake/composition';
import { createJobs } from '@credalent/jobs/composition';
import type { WorkspaceContext, WorkspacesContract } from '@credalent/workspaces';
import { createWorkspaces } from '@credalent/workspaces/composition';
import { sql } from 'drizzle-orm';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { failUnmocked } from './unmocked.ts';

// AIV-P1-103: importing candidates from a CSV or Excel file, against real PostgreSQL (as the non-owner aivera_app role)
// and Azurite, through the worker's consumer as apps/backend/worker wires it. The sheet's CV links are answered by msw
// over Node's real HTTPS client with a stubbed resolver (93.184.215.14 stands in for a public address). Synthetic cast
// (docs/00-product/personas.md), @example.com addresses and .credalent.example hosts only.

const rolesSql = readFileSync(createRequire(import.meta.url).resolve('@credalent/db/sql/roles.sql'), 'utf8');
const dbCli = join(import.meta.dirname, '..', '..', '..', 'packages', 'db', 'src', 'cli.ts');
const xlsxFixture = join(import.meta.dirname, '..', 'fixtures', 'sheets', 'candidates-12.xlsx');

const ALEX = '0190d4a2-0000-7000-8000-00000000a1e1';
const SARA = '0190d4a2-0000-7000-8000-00000000a1e3';
const OMAR = '0190d4a2-0000-7000-8000-00000000a1e2';
const NOW = new Date('2026-11-28T09:00:00.000Z');
const PUBLIC = '93.184.215.14';
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** The 12 rows of tests/integration/fixtures/sheets/candidates-12.xlsx, as a CSV. */
const NAMES = [
  'Sara Al Qahtani',
  'Arjun Menon',
  'Layla Haddad',
  'Daniel Novak',
  'Priya Nair',
  'Omar Al Suwaidi',
  'Maria Santos',
  'Hessa Al Mazrouei',
  'Karim Nasser',
  'Rana Khoury',
  'Anjali Iyer',
  'Tarek Mansour',
];
const emailOf = (name: string) => `${name.toLowerCase().replaceAll(' ', '.')}@example.com`;
const linkOf = (name: string) => `https://${name.split(' ')[0]?.toLowerCase()}.credalent.example/cv.pdf`;
const person = (name: string, link = '') => [name, emailOf(name), link];
const csvOf = (rows: string[][]) => Buffer.from(rows.map((r) => r.join(',')).join('\r\n'));
const TWELVE = csvOf([['Full name', 'E-mail', 'Resume URL'], ...NAMES.map((n) => [n, emailOf(n), linkOf(n)])]);

let pg: StartedPostgreSqlContainer;
let azurite: StartedAzuriteContainer;
let admin: Db;
let app: Db;
let workspaces: WorkspacesContract;
let blobs: BlobStore;
let files: FilesContract;
let intake: IntakeContract;
let w1: string;
let w2: string;
let jobId: string;

const resolve: Resolve = async (host) => (host.endsWith('.credalent.example') ? [{ address: PUBLIC, family: 4 }] : []);
const server = setupServer(
  http.get(`https://${PUBLIC}/gone.pdf`, () => new HttpResponse('Not here', { status: 404 })),
  http.get(`https://${PUBLIC}/cv.pdf`, ({ request }) => {
    return new HttpResponse(`%PDF-1.7\nsynthetic CV ${request.headers.get('host')}\n`, {
      headers: { 'content-type': 'application/pdf' },
    });
  }),
);

const as = <T>(userId: string, fn: (ctx: WorkspaceContext) => Promise<T>, workspaceId = w1) =>
  workspaces.withWorkspace({ userId }, workspaceId, fn);

/** The browser's part (useDirectUpload): ask, PUT with the SAS URL, and with scanning off settle it at once. */
async function uploadSheet(body: Buffer, contentType = 'text/csv', fileName = 'candidates.csv') {
  const ticket = await as(ALEX, (ctx) =>
    files.requestUpload(ctx, { purpose: 'candidate_sheet', fileName, contentType, size: body.length }),
  );
  const put = await fetch(ticket.uploadUrl, {
    method: 'PUT',
    body: new Uint8Array(body),
    headers: { 'x-ms-blob-type': 'BlockBlob', 'x-ms-blob-content-type': contentType },
  });
  expect(put.status).toBe(201);
  expect(await as(ALEX, (ctx) => files.markCleanWithoutScan(ctx, ticket.fileId))).toBe('clean');
  return ticket.fileId;
}

/** Delivers every SheetImportRequested.v1 in intake.outbox to the worker's consumer; one already handled is skipped. */
async function runWorker() {
  const handler = createSheetImportHandler({
    readCleanFile: createCleanFileReader(blobs),
    fetchCv: createCvLinkFetcher({ db: app, blobs, malwareScanning: false, now: () => NOW, resolve }),
  });
  const consumer = createConsumer({ db: app, queue: 'pack-summary', handlers: [handler], now: () => NOW });
  const rows = await admin.execute<{ id: string; workspace_id: string; payload: unknown }>(
    sql`select id, workspace_id, payload from intake.outbox where type = 'SheetImportRequested.v1' order by id`,
  );
  const settled: string[] = [];
  for (const row of rows) {
    const delivery: Delivery = {
      body: {
        id: row.id,
        type: 'SheetImportRequested.v1',
        workspaceId: row.workspace_id,
        payload: row.payload,
        occurredAt: NOW.toISOString(),
        correlationId: null,
      },
      deliveryCount: 1,
      complete: async () => void settled.push('complete'),
      abandon: async () => void settled.push('abandon'),
      deadLetter: async (reason) => void settled.push(`deadLetter: ${reason}`),
    };
    await consumer.handle(delivery);
  }
  return settled;
}

const view = (id: string, userId = ALEX, workspaceId = w1) =>
  as(userId, (ctx) => intake.getSheetImport(ctx, id), workspaceId);
const startImport = (fileId: string) =>
  as(ALEX, async (ctx) => (await intake.startSheetImport(ctx, { jobId, fileId })).sheetImportId);
const confirmMapping = (id: string, mapping: SheetImportView['mapping']) =>
  as(ALEX, (ctx) =>
    intake.confirmSheetMapping(ctx, {
      sheetImportId: id,
      mapping: { name: mapping.name ?? -1, email: mapping.email ?? -1, cvLink: mapping.cvLink, phone: mapping.phone },
    }),
  );
const addPeople = (id: string) =>
  as(ALEX, (ctx) =>
    intake.addSheetImport(ctx, {
      sheetImportId: id,
      rightToProcessConfirmed: true,
      wordingKey: 'import.rightToProcess.v1',
    }),
  );
const applicationsOnJob = async () =>
  Number(
    (await admin.execute<{ n: string }>(sql`select count(*) as n from intake.application where job_id = ${jobId}`))[0]
      ?.n,
  );

/** Upload, read and map a sheet as the recruiter would, through the worker; the view once its check is ready. */
async function importToCheck(body: Buffer, contentType?: string, fileName?: string) {
  const id = await startImport(await uploadSheet(body, contentType, fileName));
  expect(await runWorker()).not.toContain('abandon');
  const mapping = await view(id);
  expect(mapping.status).toBe('mapping');
  await confirmMapping(id, mapping.mapping);
  await runWorker();
  return { id, mapping, check: await view(id) };
}

beforeAll(async () => {
  [pg, azurite] = await Promise.all([
    new PostgreSqlContainer('pgvector/pgvector:pg17').withDatabase('aivera').start(),
    new AzuriteContainer('mcr.microsoft.com/azure-storage/azurite:3.35.0')
      .withInMemoryPersistence()
      .withSkipApiVersionCheck()
      .start(),
  ]);
  // Azurite (http) passes through; an https request no handler answers fails, so no CV link reaches the network.
  server.listen({ onUnhandledFrame: failUnmocked('https://') });
  admin = createDb(pg.getConnectionUri(), { max: 1 });
  await admin.$client.unsafe(rolesSql);
  execFileSync(process.execPath, [dbCli, 'migrate'], {
    env: {
      ...process.env,
      DATABASE_MIGRATOR_URL: `postgres://aivera_migrator:local_dev_only@${pg.getHost()}:${pg.getPort()}/aivera`,
    },
  });
  app = createDb(`postgres://aivera_app:local_dev_only@${pg.getHost()}:${pg.getPort()}/aivera`, { max: 4 });
  const audit = createAudit(app);
  workspaces = createWorkspaces(app, audit);
  const sharedKey = new StorageSharedKeyCredential(azurite.getAccountName(), azurite.getAccountKey());
  const storage = new BlobServiceClient(azurite.getBlobEndpoint(), sharedKey);
  for (const name of ['uploads-quarantine', 'cvs', 'evidence']) await storage.createContainer(name);
  blobs = createBlobStore({ url: azurite.getBlobEndpoint(), sharedKey });
  files = createFiles({ db: app, workspaces, audit, blobs, malwareScanning: false });
  const jobs = createJobs(workspaces, audit, () => NOW);
  intake = createIntake(
    workspaces,
    createCandidates(workspaces, () => NOW),
    jobs,
    displayNamesInWorkspace,
    audit,
    () => NOW,
  );
  const workspace = (name: string, creatorUserId: string) =>
    workspaces.createWorkspace({ name, company: name, hiringFocus: 'AI', synthetic: true, creatorUserId });
  w1 = (await workspace('Demo Hiring Co', ALEX)).id;
  w2 = (await workspace('Harbour Talent', OMAR)).id;
  await withWorkspace(app, w1, (tx) =>
    tx.execute(sql`insert into workspaces.member (workspace_id, user_id, role, status)
      values (${w1}, ${SARA}, 'recruiter', 'active')`),
  );
  jobId = (
    await as(ALEX, (ctx) =>
      jobs.createJob(ctx, {
        title: 'Senior AI Engineer',
        jobType: 'ai_llm_engineering',
        description: 'Senior AI Engineer, synthetic.',
        synthetic: true,
      }),
    )
  ).id;
});

afterAll(async () => {
  server.close();
  await app?.$client.end();
  await admin?.$client.end();
  await Promise.all([pg?.stop(), azurite?.stop()]);
});

const peopleOf = (check: SheetImportView) =>
  check.rows.flatMap((r) => (r.problem === null ? [{ name: r.name, email: r.email, cv: r.cv }] : []));

describe('Scenario: Map the columns and import', () => {
  let csvCheck: SheetImportView;

  it('proposes Name, Email and CV link, lists 12 people with their CVs, and adds nobody until confirmed', async () => {
    const { id, mapping, check } = await importToCheck(TWELVE);
    expect(mapping.headers).toEqual(['Full name', 'E-mail', 'Resume URL']);
    expect(mapping.mapping).toEqual({ name: 0, email: 1, cvLink: 2, phone: null });
    expect(check.status).toBe('ready');
    expect(peopleOf(check)).toEqual(NAMES.map((n) => ({ name: n, email: emailOf(n), cv: 'attached' })));
    csvCheck = check;
    // Every CV went through the files module as the recruiter's `cv` upload, settled clean (scanning off in dev).
    const cvs = await admin.execute<{ purpose: string; status: string; uploaded_by: string; blob_path: string }>(
      sql`select purpose, status, uploaded_by, blob_path from files.file where purpose = 'cv'`,
    );
    expect(cvs).toHaveLength(12);
    for (const cv of cvs) {
      expect(cv).toMatchObject({ purpose: 'cv', status: 'clean', uploaded_by: ALEX });
      expect(cv.blob_path).toMatch(/^cvs\/w\//);
    }
    // SAFETY: nothing is added before "Add 12 people to this job".
    // SAFETY: mutation check: getSheetImport added the ready rows through receiveBatch -> this test failed (12, not 0)
    expect(await applicationsOnJob()).toBe(0);

    await addPeople(id);
    const sources = await admin.execute<{ source: string; file_ids: string[] }>(
      sql`select s.source, s.file_ids from intake.application_source s
        join intake.application a on a.id = s.application_id where a.job_id = ${jobId}`,
    );
    expect(sources).toHaveLength(12);
    expect(sources.every((s) => s.source === 'spreadsheet' && s.file_ids.length === 1)).toBe(true);
    const [batch] = await admin.execute<{ after: { cvs: number } }>(
      sql`select after from audit.entry where action = 'intake.batch_confirmed'`,
    );
    expect(batch?.after.cvs).toBe(12);
    // SAFETY: mutation check: dropped `rows: null` from addSheetImport's move to added -> this test failed (12 rows kept)
    // The sheet's names, emails and links are not kept once the applications hold them (AGENTS.md 1.9).
    const [stored] = await admin.execute<{ rows: unknown }>(
      sql`select rows from intake.sheet_imports where id = ${id}`,
    );
    expect(stored?.rows).toBeNull();
    expect(await view(id)).toMatchObject({ status: 'added', rows: [] });
    await expect(addPeople(id)).rejects.toThrow(new IntakeError('sheet_not_ready'));
    expect(await applicationsOnJob()).toBe(12);
  });

  it('Scenario: Excel works the same way: the same 12 rows as an .xlsx give the same mapping and check', async () => {
    const { mapping, check } = await importToCheck(readFileSync(xlsxFixture), XLSX, 'candidates.xlsx');
    expect(mapping.mapping).toEqual({ name: 0, email: 1, cvLink: 2, phone: null });
    expect(check.rows).toEqual(csvCheck.rows);
  });
});

describe('Scenario Outline: Rows that cannot be used are explained by row number', () => {
  it('row 4 missing email, row 7 email not valid, row 9 a 404 link, and links not HTTPS to a public host', async () => {
    const { check } = await importToCheck(
      csvOf([
        ['Full name', 'E-mail', 'Resume URL'],
        person('Sneha Iyer'),
        person('Lukas Schmidt'),
        ['Karim Nasser', '', ''],
        person('Rana Khoury'),
        person('Anjali Iyer'),
        ['Tarek Mansour', 'not-an-email', ''],
        person('Priya Nair'),
        person('Maria Santos', 'https://maria.credalent.example/gone.pdf'),
        person('Daniel Novak', 'http://cv.credalent.example/a.pdf'),
        person('Arjun Menon', 'https://127.0.0.1/a.pdf'),
        person('Layla Haddad', 'https://169.254.169.254/metadata'),
        person('Omar Al Suwaidi', 'https://10.0.0.5/cv.pdf'),
      ]),
    );
    const byRow = new Map(check.rows.map((r) => [r.row, r]));
    // A problem row carries its number and problem only, never the row's values.
    expect(byRow.get(4)).toEqual({ row: 4, problem: 'missing_email' });
    expect(byRow.get(7)).toEqual({ row: 7, problem: 'invalid_email' });
    for (const row of [9, 10, 11, 12, 13]) expect(byRow.get(row)).toMatchObject({ problem: null, cv: 'unreadable' });
    expect(byRow.get(2)).toMatchObject({ problem: null, cv: 'none' });
    // Each guard refusal makes no request at all: proven in cv-link-fetch.test.ts.
  });

  it('a sheet over 1,000 rows is refused whole, before any row is read', async () => {
    const rows = Array.from({ length: 1001 }, (_, i) => [`Sneha Iyer ${i}`, `sneha.iyer+${i}@example.com`, '']);
    const id = await startImport(await uploadSheet(csvOf([['Full name', 'E-mail', 'Resume URL'], ...rows])));
    await runWorker();
    expect(await view(id)).toMatchObject({ status: 'unreadable', problem: 'too_many_rows', headers: [] });
  });
});

describe('Fetched CVs go through quarantine and the scan', () => {
  it('with malware scanning on, a fetched CV waits in uploads-quarantine as a pending cv file', async () => {
    const fetchCv = createCvLinkFetcher({ db: app, blobs, malwareScanning: true, now: () => NOW, resolve });
    const fileId = await fetchCv(w1, ALEX, 'https://hessa.credalent.example/cv.pdf');
    const [file] = await admin.execute<{ status: string; blob_path: string; purpose: string }>(
      sql`select status, blob_path, purpose from files.file where id = ${fileId}`,
    );
    expect(file).toEqual({ status: 'pending', purpose: 'cv', blob_path: `uploads-quarantine/w/${w1}/${fileId}` });
    expect(await blobs.read(file?.blob_path ?? '', 1024)).not.toBeNull();
  });
});

describe('Row-level security and ownership of a sheet import', () => {
  it('another workspace, and another member of the same one, cannot read it; RLS alone hides its rows', async () => {
    const { id } = await importToCheck(
      csvOf([
        ['Name', 'Email'],
        ['Sneha Iyer', 'sneha.iyer@example.com'],
      ]),
    );
    await expect(view(id, OMAR, w2)).rejects.toThrow(new IntakeError('sheet_not_found'));
    await expect(view(id, SARA)).rejects.toThrow(new IntakeError('sheet_not_found'));
    // SAFETY: mutation check: disabled row-level security on intake.sheet_imports -> this test failed (W2 counted W1 rows)
    const seen = await withWorkspace(app, w2, (tx) =>
      tx.execute<{ n: number }>(sql`select count(*)::int as n from intake.sheet_imports`),
    );
    expect(seen[0]?.n).toBe(0);
  });
});

describe('Scenario: The sheet never leaves the database and Blob', () => {
  // SAFETY: mutation check: console.log(JSON.stringify(withCvs)) in advanceSheetImport -> this test failed (names logged)
  it('no log line or error message holds a name, email or CV link of the sheet', async () => {
    const out: string[] = [];
    const write = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      out.push(String(chunk));
      return true;
    });
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      out.push(String(chunk));
      return true;
    });
    // Vitest routes console output around process.stdout, so console is captured too.
    const consoles = (['log', 'info', 'warn', 'error', 'debug'] as const).map((level) =>
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => void out.push(JSON.stringify(args))),
    );
    const errors: string[] = [];
    try {
      const { id } = await importToCheck(TWELVE);
      await addPeople(id).catch((error: unknown) => errors.push(String(error)));
      // A redelivery, a refused second add and a refused mapping are logged or thrown too.
      await runWorker();
      await addPeople(id).catch((error: unknown) => errors.push(String(error)));
      await confirmMapping(id, { name: 0, email: 0, cvLink: null, phone: null }).catch((error: unknown) =>
        errors.push(String(error)),
      );
    } finally {
      write.mockRestore();
      stderr.mockRestore();
      for (const spy of consoles) spy.mockRestore();
    }
    expect(errors.length).toBeGreaterThan(0);
    const written = [...out, ...errors].join('\n').toLowerCase();
    for (const name of NAMES) {
      for (const value of [name, emailOf(name), linkOf(name), name.split(' ')[0] ?? name])
        expect(written).not.toContain(value.toLowerCase());
    }
  });
});
