import { createAudit } from '@credalent/audit/composition';
import { createDb } from '@credalent/db/client';
import { withWorkspace } from '@credalent/db/with-workspace';
import { createJobs } from '@credalent/jobs/composition';
import { createWorkspaces } from '@credalent/workspaces/composition';
import { type Page } from '@playwright/test';
import { sql } from 'drizzle-orm';
import { databaseUrl } from '../playwright.config.ts';
import { signIn } from './auth.ts';
import { expect, test } from './csp.ts';
import { expectAccessible, themes } from './gallery.ts';
import { approvedWorkspace, syntheticUser } from './workspaces.ts';

// AIV-P1-101, AIV-P1-165: "Add CVs" (the stage once called Bring in candidates), as AP, admin of "Demo" (seed.ts): Senior AI Engineer has version 2 approved and is
// not published.
// shortcut: this harness has no Blob storage (AZURE_STORAGE_BLOB_URL unset), so no CV is stored here and upload to
// ranking is proven against Azurite and PostgreSQL in tests/integration/src/add-applicants.test.ts; add the step here
// when Azurite joins the e2e harness.
const AP = 'ap@example.com';
// Its own workspace and users for the waiting rubric and the job-scoped member (made through the contracts, as seed.ts
// does), so no seeded user, job or screenshot changes: a sign-in renames a user to the email's local part.
let creator: string;
let owner: string;
const IMPORT_PATH = /^\/app\/jobs\/[0-9a-f-]{36}\/import$/;

const row = (page: Page, title: string) => page.getByRole('row').filter({ hasText: title });

async function openFromJobs(page: Page, title: string) {
  await page.goto('/app/jobs');
  await row(page, title).getByRole('link', { name: 'Add CVs' }).click();
  await expect(page).toHaveURL((url) => IMPORT_PATH.test(url.pathname));
  // The title streams in after the page commits: waiting for it means axe never reads a page mid-navigation.
  await expect(page).toHaveTitle(`${title}: Add CVs · Credalent`);
}

const picker = (page: Page) => page.getByRole('combobox', { name: 'Add CVs to this job' });
const pdf = (n: number) => ({
  name: `cv-sample-${n}.pdf`,
  mimeType: 'application/pdf',
  buffer: Buffer.from(`%PDF-1.7 ${n}`),
});
const png = { name: 'photo-sample.png', mimeType: 'image/png', buffer: Buffer.from('png') };

/** One pick of several files in the Add CVs dialog: the multi-file input, through the browser's own file chooser. */
async function pickFiles(page: Page, files: { name: string; mimeType: string; buffer: Buffer }[]) {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('dialog', { name: 'Add CVs' }).getByRole('button', { name: 'Choose CV files' }).click();
  await (await chooser).setFiles(files);
}

test.beforeAll(async () => {
  const stamp = Date.now();
  creator = `alex+import-${stamp}@example.com`;
  owner = `hana+import-${stamp}@example.com`;
  const { workspaceId, creatorUserId } = await approvedWorkspace(creator, `Import ${stamp}`);
  const db = createDb(databaseUrl, { max: 1 });
  try {
    const audit = createAudit(db);
    const workspaces = createWorkspaces(db, audit);
    const jobs = createJobs(workspaces, audit);
    const ownerUserId = await syntheticUser(db, owner);
    await withWorkspace(db, workspaceId, (tx) =>
      tx.execute(sql`insert into workspaces.member (workspace_id, user_id, role, status)
        values (${workspaceId}, ${ownerUserId}, 'hiring_owner', 'active')`),
    );
    await workspaces.switchWorkspace({ userId: ownerUserId }, workspaceId);
    await workspaces.withWorkspace({ userId: creatorUserId }, workspaceId, async (ctx) => {
      for (const title of ['Platform Engineer', 'Staff ML Engineer']) {
        const job = await jobs.createJob(ctx, {
          title,
          jobType: 'ai_llm_engineering',
          hiringOwnerUserId: ownerUserId,
          description: `${title}, synthetic e2e job.`,
          synthetic: true,
        });
        const version = await jobs.saveRubric(ctx, job.id, {
          successStatement: 'Ships reliable work.',
          competencies: [
            { name: 'Delivery', evidenceExpected: 'A repository or a document', weightPercent: 60, levelNeeded: 4 },
            { name: 'Communication', evidenceExpected: 'A write-up or a reference', weightPercent: 40, levelNeeded: 3 },
          ].map((c) => ({ ...c, type: 'mandatory', origin: 'from_description' })),
        });
        if (title === 'Staff ML Engineer') await jobs.submitRubric(ctx, version.id);
      }
    });
  } finally {
    await db.$client.end();
  }
});

test('Scenario: The page for Senior AI Engineer', async ({ page }) => {
  await signIn(page, { email: AP });
  await openFromJobs(page, 'Senior AI Engineer');
  await expect(page.getByRole('heading', { level: 2, name: 'Add CVs' })).toBeVisible();
  // Demo is not an agency: the intro does not promise the client check.
  await expect(page.getByText(/a client has already seen/)).toHaveCount(0);
  await expect(picker(page).locator('option:checked')).toHaveText('Senior AI Engineer · rubric approved, version 2');
  await expect(page.getByRole('heading', { level: 3, name: 'From CV files' })).toBeVisible();
  await expect(
    page.getByText(
      'PDF or Word, up to 200 per save. Links to repositories, portfolios and write-ups are found automatically.',
    ),
  ).toBeVisible();
  // Hidden until candidate-site applications arrive (AIV-P3-008).
  await expect(page.getByText(/published job listing/)).toHaveCount(0);
  const stages = page.getByRole('navigation', { name: 'Stages of this job' });
  await expect(stages.getByRole('link', { name: /^Add CVs/ })).toHaveAttribute('aria-current', 'page');
  await expect(stages.getByRole('link', { name: /^Add CVs/ })).toHaveText(/^Add CVs(Not started|\d+ imported)$/);
});

test('Scenario: Importing into a job whose rubric is waiting', async ({ page }) => {
  await signIn(page, { email: creator });
  await openFromJobs(page, 'Platform Engineer');
  const from = new URL(page.url()).pathname;
  await picker(page).selectOption({ label: 'Staff ML Engineer · rubric waiting for approval' });
  await expect(page).toHaveTitle('Staff ML Engineer: Add CVs · Credalent');
  // Scenario: No candidate data in the URL: the opaque job id, nothing else.
  const url = new URL(page.url());
  expect(url.pathname).toMatch(IMPORT_PATH);
  expect(url.pathname).not.toBe(from);
  expect(url.search).toBe('');
  await expect(picker(page).locator('option:checked')).toHaveText('Staff ML Engineer · rubric waiting for approval');
  await expect(
    page.getByText('For a job whose rubric is still waiting, people are added now and assessed once it is approved.', {
      exact: false,
    }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add CVs' })).toBeVisible();
});

// WCAG 3.2.2: Chromium on Linux and Windows changes a closed select's value on ArrowDown, which opens that job's page;
// the picker says so before it is used, as its description. This relies on Linux Chromium firing `change` on a closed
// select (macOS opens the list instead): CI is the reference.
test('The picker says that choosing a job opens its page, and ArrowDown does', async ({ page }) => {
  await signIn(page, { email: AP });
  await openFromJobs(page, 'Senior AI Engineer');
  const from = new URL(page.url()).pathname;
  await expect(picker(page)).toHaveAccessibleDescription('Choosing a job opens its page.');
  const next = await picker(page).evaluate((select: HTMLSelectElement) => {
    const option = select.options[select.selectedIndex + 1];
    return option ? option.text.split(' · ')[0] : null;
  });
  if (!next) throw new Error('Senior AI Engineer is the last job in the picker.');
  await picker(page).focus();
  await page.keyboard.press('ArrowDown');
  await expect(page).toHaveTitle(`${next}: Add CVs · Credalent`);
  expect(new URL(page.url()).pathname).not.toBe(from);
});

// AIV-P1-165: the header's "Add CVs" opens the dialog over the job page, for that job, with no job picker.
test('Scenario: The header button opens the dialog on the job page', async ({ page }) => {
  await signIn(page, { email: AP });
  await openFromJobs(page, 'Senior AI Engineer');
  const stages = page.getByRole('navigation', { name: 'Stages of this job' });
  for (const [stage, title] of [
    [/^Evidence and ranking/, 'Evidence and ranking'],
    [/^Competencies and rubric/, 'Competencies and rubric'],
  ] as const) {
    await stages.getByRole('link', { name: stage }).click();
    await expect(page).toHaveTitle(`Senior AI Engineer: ${title} · Credalent`);
    const url = page.url();
    await page.getByRole('button', { name: 'Add CVs' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add CVs' });
    await expect(dialog).toBeVisible();
    expect(page.url()).toBe(url);
    await expect(dialog.getByRole('combobox')).toHaveCount(0);
    await expect(
      dialog.getByText('the right to process these CVs for Senior AI Engineer.', { exact: false }),
    ).toBeVisible();
    await expect(dialog.getByText(/a client has already seen/)).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  }
});

// AIV-P1-165: this harness has no Blob storage, so no CV is stored; what this proves is that one pick lists every
// file by its name with its own result, and the page neither resets nor stops responding. Synthetic file names only.
test('Scenario Outline: Several files at once, each validated: listed by name, the page keeps going', async ({
  page,
}) => {
  await signIn(page, { email: AP });
  await openFromJobs(page, 'Senior AI Engineer');
  const url = page.url();
  await page.getByRole('button', { name: 'Add CVs' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add CVs' });
  await pickFiles(page, [1, 2, 3, 4, 5, 6].map(pdf).concat(png));
  const files = dialog.getByRole('list', { name: '7 files' });
  await expect(files.getByRole('listitem')).toHaveCount(7);
  await expect(files.getByText('photo-sample.png · not added: PDF or Word, up to 10 MB.')).toBeVisible();
  for (const n of [1, 2, 3, 4, 5, 6])
    await expect(files.getByText(`cv-sample-${n}.pdf · `, { exact: false })).toBeVisible();
  expect(page.url()).toBe(url);
  await expect(dialog).toBeVisible();
  // The site keeps responding: a stage link still navigates while the uploads settle.
  await page.keyboard.press('Escape');
  await page
    .getByRole('navigation', { name: 'Stages of this job' })
    .getByRole('link', { name: /^Evidence and ranking/ })
    .click();
  await expect(page).toHaveTitle('Senior AI Engineer: Evidence and ranking · Credalent', { timeout: 10_000 });
});

// AIV-P1-165: 201 in one pick lists the first 200 and says "200 per save".
test('Scenario Outline: 201 CVs in one pick: the first 200 listed, "200 per save" stated', async ({ page }) => {
  await signIn(page, { email: AP });
  await openFromJobs(page, 'Senior AI Engineer');
  await page.getByRole('button', { name: 'Add CVs' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add CVs' });
  await pickFiles(
    page,
    Array.from({ length: 201 }, (_, n) => pdf(n)),
  );
  await expect(dialog.getByRole('list', { name: '200 files' }).getByRole('listitem')).toHaveCount(200);
  await expect(dialog.getByRole('alert').filter({ hasText: '1 more CV was not added: 200 per save.' })).toBeVisible();
});

test('Scenario: Sources that are not built are not offered', async ({ page }) => {
  await signIn(page, { email: AP });
  await openFromJobs(page, 'Senior AI Engineer');
  await expect(page.getByRole('heading', { level: 3, name: 'From CV files' })).toBeVisible();
  for (const name of ['Connect ATS', 'Copy address', 'Choose from pool', 'Import file'])
    await expect(page.getByRole('button', { name })).toHaveCount(0);
});

// AIV-P1-165: Scenario: Source and consent are asked once (no source chosen when it opens; reopened, it starts again).
test('"Add CVs" opens the dialog from the keyboard, with no source chosen, and Escape returns to it', async ({
  page,
}) => {
  await signIn(page, { email: AP });
  await openFromJobs(page, 'Senior AI Engineer');
  await picker(page).focus();
  await page.keyboard.press('Tab');
  const upload = page.getByRole('button', { name: 'Add CVs' });
  await expect(upload).toBeFocused();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Add CVs' });
  await expect(dialog).toBeVisible();
  for (const radio of await dialog.getByRole('radio').all()) await expect(radio).not.toBeChecked();
  await dialog.getByRole('checkbox').check();
  await dialog.getByRole('radio', { name: 'Referral' }).check();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(upload).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(dialog.getByRole('radio', { name: 'Referral' })).not.toBeChecked();
  await expect(dialog.getByRole('checkbox')).not.toBeChecked();
});

// The interviewer and the hiring owner share the job-scoped path (loadJobHeader's canImport); the hiring owner here owns
// Platform Engineer. The add-applicants action's own 403 for an interviewer on the job: add-applicants.test.ts.
test('Scenario: A job-scoped member cannot bring candidates in: the message, no upload control', async ({
  page,
  context,
}) => {
  await signIn(page, { email: creator });
  await openFromJobs(page, 'Platform Engineer');
  const url = page.url();
  await context.clearCookies({ name: '__Host-credalent-session' });
  await signIn(page, { email: owner });
  await page.goto(url);
  await expect(page.getByText('You do not have access to this. Ask your workspace admin.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add CVs' })).toHaveCount(0);
  await expect(picker(page)).toHaveCount(0);
  // Nor any way in from the job's header.
  await page
    .getByRole('navigation', { name: 'Stages of this job' })
    .getByRole('link', { name: /^Competencies and rubric/ })
    .click();
  await expect(page.getByRole('button', { name: 'Add CVs' })).toHaveCount(0);
});

test("Scenario: Another workspace's job", async ({ page, context }) => {
  await signIn(page, { email: AP });
  await openFromJobs(page, 'Senior AI Engineer');
  const path = new URL(page.url()).pathname;
  await context.clearCookies({ name: '__Host-credalent-session' });
  // The creator runs "Import <stamp>", another workspace.
  await signIn(page, { email: creator });
  expect((await page.goto(path))?.status()).toBe(404);
  await expect(page.getByText('This job does not exist or you do not have access.')).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Add CVs to this job' })).toHaveCount(0);
  await expect(page.getByText('Senior AI Engineer')).toHaveCount(0);
});

for (const theme of themes) {
  test(`axe passes on Add CVs, with the dialog open (${theme})`, async ({ page, context, baseURL }) => {
    await context.addCookies([{ name: 'theme', value: theme, url: baseURL ?? '' }]);
    await signIn(page, { email: AP });
    await openFromJobs(page, 'Senior AI Engineer');
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await expectAccessible(page);
    // For comparing with docs/01-design/artboards/Import.dc.html (AGENTS.md section 4).
    await expect(page).toHaveScreenshot(`import-${theme}.png`, { fullPage: true });
    await page.getByRole('button', { name: 'Add CVs' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add CVs' });
    await expect(dialog).toBeVisible();
    await expectAccessible(page);
    // With a listed file and a refused one, so the rows' colours are checked too.
    await pickFiles(page, [pdf(1), png]);
    await expect(dialog.getByRole('list', { name: '2 files' })).toBeVisible();
    await expectAccessible(page);
  });
}
