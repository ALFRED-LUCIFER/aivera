import { createAudit } from '@credalent/audit/composition';
import { createCandidates, displayNamesInWorkspace } from '@credalent/candidates/composition';
import { createDb, type Db } from '@credalent/db/client';
import { createConsumer, type Delivery } from '@credalent/db/consumer';
import { withWorkspace } from '@credalent/db/with-workspace';
import type { IntakeContract } from '@credalent/intake';
import { createIntake, createSheetImportHandler } from '@credalent/intake/composition';
import { createJobs } from '@credalent/jobs/composition';
import type { Page } from '@playwright/test';
import type { WorkspaceContext, WorkspacesContract } from '@credalent/workspaces';
import { createWorkspaces } from '@credalent/workspaces/composition';
import { sql } from 'drizzle-orm';
import { databaseUrl } from '../playwright.config.ts';
import { signIn } from './auth.ts';
import { expect, test } from './csp.ts';
import { expectAccessible, themes } from './gallery.ts';
import { approvedWorkspace } from './workspaces.ts';

// AIV-P1-103, J2: import candidates from a synthetic CSV and confirm, by keyboard, in light and dark. This harness has
// no Blob storage and no worker (AZURE_STORAGE_BLOB_URL unset), so the spec starts each import as the page's action
// would once the upload is clean, and plays the worker through its own consumer and handler with the file read and the
// CV fetch stubbed. The upload, the scan, the real CV fetch and its SSRF guard are proven against PostgreSQL, Azurite
// and msw in tests/integration/src/sheet-import.test.ts and cv-link-fetch.test.ts. Its own workspace and jobs, so no
// seeded job, count or screenshot changes. Synthetic cast (docs/00-product/personas.md) and @example.com only.

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
const HEADER = ['Full name', 'E-mail', 'Resume URL'];
const TWELVE = csvOf([HEADER, ...NAMES.map((n) => [n, emailOf(n), linkOf(n)])]);

let creator: string;
let creatorUserId: string;
let workspaceId: string;
let db: Db;
let workspaces: WorkspacesContract;
let jobs: ReturnType<typeof createJobs>;
let intake: IntakeContract;
/** The uploaded sheets by file id: the stand-in for the clean blob the worker reads. */
const sheets = new Map<string, Buffer>();

const as = <T>(fn: (ctx: WorkspaceContext) => Promise<T>) =>
  workspaces.withWorkspace({ userId: creatorUserId }, workspaceId, fn);

test.beforeAll(async () => {
  const stamp = Date.now();
  creator = `alex+sheet-${stamp}@example.com`;
  ({ workspaceId, creatorUserId } = await approvedWorkspace(creator, `Sheet import ${stamp}`));
  db = createDb(databaseUrl, { max: 2 });
  const audit = createAudit(db);
  workspaces = createWorkspaces(db, audit);
  jobs = createJobs(workspaces, audit);
  intake = createIntake(workspaces, createCandidates(workspaces), jobs, displayNamesInWorkspace, audit);
});
test.afterAll(async () => {
  await db?.$client.end();
});

const newJob = (title: string) =>
  as(
    async (ctx) =>
      (
        await jobs.createJob(ctx, {
          title,
          jobType: 'ai_llm_engineering',
          description: `${title}, synthetic e2e job.`,
          synthetic: true,
        })
      ).id,
  );

/** What the page's action does once the upload is clean: the import starts, and the worker reads it next. */
const startImport = (jobId: string, sheet: Buffer) => {
  const fileId = crypto.randomUUID();
  sheets.set(fileId, sheet);
  return as(async (ctx) => (await intake.startSheetImport(ctx, { jobId, fileId })).sheetImportId);
};

/** The worker: every SheetImportRequested.v1 of this workspace through the consumer; one already handled is skipped. */
async function runWorker() {
  const handler = createSheetImportHandler({
    readCleanFile: async (_tx, _workspaceId, fileId) => {
      const data = sheets.get(fileId);
      return data ? { purpose: 'candidate_sheet', contentType: 'text/csv', data } : 'rejected';
    },
    // A link to gone.pdf answers 404; any other is fetched and stored as a CV (its file id).
    fetchCv: async (_workspaceId, _uploadedBy, url) => (url.includes('gone') ? null : crypto.randomUUID()),
  });
  const consumer = createConsumer({ db, queue: 'pack-summary', handlers: [handler], now: () => new Date() });
  const events = await withWorkspace(db, workspaceId, (tx) =>
    tx.execute<{ id: string; payload: unknown; occurred_at: string }>(
      sql`select id, payload, occurred_at::text from intake.outbox where type = 'SheetImportRequested.v1' order by id`,
    ),
  );
  for (const event of events) {
    const delivery: Delivery = {
      body: {
        id: event.id,
        type: 'SheetImportRequested.v1',
        workspaceId,
        payload: event.payload,
        occurredAt: new Date(event.occurred_at).toISOString(),
        correlationId: null,
      },
      deliveryCount: 1,
      complete: async () => undefined,
      abandon: async () => undefined,
      deadLetter: async () => undefined,
    };
    await consumer.handle(delivery);
  }
}

const applicationsOn = async (jobId: string) =>
  Number(
    (
      await withWorkspace(db, workspaceId, (tx) =>
        tx.execute<{ n: string }>(sql`select count(*) as n from intake.application where job_id = ${jobId}`),
      )
    )[0]?.n,
  );

async function openImport(page: Page, jobId: string, sheetImportId?: string) {
  await page.goto(`/app/jobs/${jobId}/import/sheet${sheetImportId ? `?import=${sheetImportId}` : ''}`);
  await expect(page.getByRole('heading', { name: 'Import from a CSV or Excel file' })).toBeVisible();
}

const selected = (page: Page, label: string) => page.getByLabel(label, { exact: true }).locator('option:checked');

for (const theme of themes) {
  test(`Scenario: Map the columns and import: 12 people from the spreadsheet, added on confirm (${theme})`, async ({
    page,
    context,
    baseURL,
  }) => {
    const jobId = await newJob(`Senior AI Engineer ${theme}`);
    const sheetImportId = await startImport(jobId, TWELVE);
    await runWorker();
    await context.addCookies([{ name: 'theme', value: theme, url: baseURL ?? '' }]);
    await signIn(page, { email: creator });
    await openImport(page, jobId, sheetImportId);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);

    // The proposed mapping, from the header row.
    await expect(page.getByRole('heading', { name: 'Match the columns' })).toBeVisible();
    await expect(selected(page, 'Name')).toHaveText('Full name');
    await expect(selected(page, 'Email')).toHaveText('E-mail');
    await expect(selected(page, 'CV link')).toHaveText('Resume URL');
    await expect(selected(page, 'Phone')).toHaveText('Not in this file');
    await expectAccessible(page);

    // Confirmed from the keyboard; the worker then checks the rows and fetches the CVs, and the page reloads itself.
    await page.getByRole('button', { name: 'Use these columns' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByText('Checking each row and reading the CV links…')).toBeVisible();
    await runWorker();
    const table = page.getByRole('table', { name: '12 people to add' });
    await expect(table).toBeVisible();
    await expect(table.getByRole('row')).toHaveCount(13);
    for (const name of NAMES) {
      await expect(table.getByRole('row').filter({ hasText: name })).toContainText('Spreadsheet');
    }
    await expect(table.getByRole('row').filter({ hasText: 'Sara Al Qahtani' })).toContainText('CV attached');

    // Nobody is added until "Add 12 people to this job", which waits for the confirmation tick.
    const add = page.getByRole('button', { name: 'Add 12 people to this job' });
    await expect(add).toBeDisabled();
    await expect(page.getByText('Nothing changes until you confirm.')).toBeVisible();
    expect(await applicationsOn(jobId)).toBe(0);
    await expectAccessible(page);

    const tick = page.getByRole('checkbox', {
      name: `I am responsible for having the right to process these CVs for Senior AI Engineer ${theme}.`,
    });
    await tick.focus();
    await page.keyboard.press('Space');
    await expect(add).toBeEnabled();
    await add.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByText(`12 people added to Senior AI Engineer ${theme}.`)).toBeVisible();
    expect(await applicationsOn(jobId)).toBe(12);
    await expectAccessible(page);
  });
}

test('Scenario Outline: Rows that cannot be used are explained by row number, without their values', async ({
  page,
}) => {
  const jobId = await newJob('QA Automation Engineer');
  const sheetImportId = await startImport(
    jobId,
    csvOf([
      HEADER,
      person('Sneha Iyer'),
      person('Lukas Schmidt'),
      ['Karim Nasser', '', ''],
      person('Rana Khoury'),
      person('Anjali Iyer'),
      ['Tarek Mansour', 'not-an-email', ''],
      person('Priya Nair'),
      person('Maria Santos', 'https://maria.credalent.example/gone.pdf'),
    ]),
  );
  await runWorker();
  await signIn(page, { email: creator });
  await openImport(page, jobId, sheetImportId);
  await page.getByRole('button', { name: 'Use these columns' }).click();
  await expect(page.getByText('Checking each row and reading the CV links…')).toBeVisible();
  await runWorker();
  const notes = page.getByRole('region', { name: 'Rows to look at' });
  await expect(notes.getByRole('listitem')).toHaveText([
    'Row 4: Not added: missing email',
    'Row 7: Not added: email not valid',
    'Row 9: CV link could not be read',
  ]);
  // The unusable rows' values appear nowhere on the page, and the URL carries the import's opaque id only.
  await expect(page.getByText('Karim Nasser')).toHaveCount(0);
  await expect(page.getByText('not-an-email')).toHaveCount(0);
  expect(page.url()).toMatch(/\/import\/sheet\?import=[0-9a-f-]{36}$/);
  // Row 9 is still added, with no CV yet.
  await expect(page.getByRole('table', { name: '6 people to add' })).toContainText('Maria Santos');
  await expect(page.getByRole('button', { name: 'Add 6 people to this job' })).toBeDisabled();
});

for (const [file, payload] of [
  ['a 5 MB CSV', { name: 'candidates.csv', mimeType: 'text/csv', buffer: Buffer.alloc(5 * 1024 * 1024, 'a') }],
  [
    'a .numbers file',
    { name: 'candidates.numbers', mimeType: 'application/x-iwork-numbers-sffnumbers', buffer: TWELVE },
  ],
] as const) {
  test(`Scenario: Too large or the wrong type: ${file} shows "Use a CSV or Excel file up to 2 MB" and nothing is read`, async ({
    page,
  }) => {
    const jobId = await newJob('Staff Backend Engineer');
    await signIn(page, { email: creator });
    await openImport(page, jobId);
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Import file' }).click();
    // The picker's `accept` only filters the browser's dialog; a file chosen anyway is still refused.
    await (await chooser).setFiles(payload);
    await expect(page.getByText('Use a CSV or Excel file up to 2 MB.')).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/app/jobs/${jobId}/import/sheet$`));
  });
}
