import { type Locator, type Page } from '@playwright/test';
import { signIn } from './auth.ts';
import { expect, test } from './csp.ts';
import { expectAccessible, themes } from './gallery.ts';

// AIV-P1-019: "Add applicants", opened by "Upload files" on a job's Bring in candidates page (AIV-P1-101), as AP, admin
// of "Demo" (seed.ts). This harness has no Blob
// storage (AZURE_STORAGE_BLOB_URL unset), so no CV is stored here: the upload-to-application path is proven against
// Azurite and PostgreSQL in tests/integration/src/add-applicants.test.ts. This spec covers the dialog itself.
const AP = 'ap@example.com';

async function openDialog(page: Page) {
  await page.goto('/app/jobs');
  // The title streams in after the page commits: waiting for it means axe never reads a page mid-navigation.
  await page
    .getByRole('row')
    .filter({ hasText: 'Senior AI Engineer' })
    .getByRole('link', { name: 'Import candidates' })
    .click();
  await expect(page).toHaveURL(/\/import$/);
  await expect(page).toHaveTitle('Senior AI Engineer: Bring in candidates · Credalent');
  await page.getByRole('button', { name: 'Upload files' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add applicants' });
  await expect(dialog).toBeVisible();
  return dialog;
}

const refused = [
  ['a 25 MB PDF CV', { name: 'cv-sample.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(25 * 1024 * 1024) }],
  ['a PNG image', { name: 'cv-sample.png', mimeType: 'image/png', buffer: Buffer.alloc(2048) }],
] as const;

for (const [file, payload] of refused) {
  test(`Scenario Outline: Infected or oversized files are refused: ${file} shows "PDF or Word, up to 10 MB."`, async ({
    page,
  }) => {
    await signIn(page, { email: AP });
    const dialog = await openDialog(page);
    await expect(dialog.getByRole('radio', { name: 'LinkedIn' })).toBeChecked();
    await expect(dialog.getByRole('button', { name: 'Add applicants' })).toBeDisabled();

    const chooser = page.waitForEvent('filechooser');
    await dialog.getByRole('button', { name: 'Upload CV' }).click();
    // The picker's `accept` only filters the browser's dialog; a file chosen anyway is still refused.
    await (await chooser).setFiles({ ...payload, buffer: Buffer.from(payload.buffer) });
    await expect(dialog.locator('p').filter({ hasText: 'PDF or Word, up to 10 MB.' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Add applicants' })).toBeDisabled();
  });
}

test('the dialog is keyboard operable: source, upload, then close with Escape back to its button', async ({ page }) => {
  await signIn(page, { email: AP });
  const dialog = await openDialog(page);
  // Radix moves focus into the dialog; the sources are one radio group, chosen with the arrow keys.
  await dialog.getByRole('radio', { name: 'LinkedIn' }).focus();
  await page.keyboard.press('ArrowDown');
  await expect(dialog.getByRole('radio', { name: 'Referral' })).toBeChecked();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Upload CV' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('button', { name: 'Upload files' })).toBeFocused();
});

// AIV-P1-034: the ranked candidates, replacing AIV-P1-086's plain list. seed.ts files nine applicants on Senior AI
// Engineer and writes an assessment result for eight, as personas.md scores them; Youssef Aziz is not assessed yet.
async function openCandidates(page: Page) {
  await page.goto('/app/jobs');
  await page.getByRole('link', { name: 'Senior AI Engineer' }).click();
  await expect(page).toHaveTitle('Senior AI Engineer: Evidence and ranking · Credalent');
  return page.getByRole('table', { name: 'Ranked candidates' });
}
const bodyRows = (table: Locator) => table.getByRole('row').filter({ has: table.page().getByRole('cell') });
const FAIRNESS = 'Ranking orders your attention. Nobody is rejected automatically.';

test('Scenario: The ranking for Senior AI Engineer', async ({ page }) => {
  await signIn(page, { email: AP });
  const table = await openCandidates(page);
  // The URL carries the job's opaque id only.
  expect(new URL(page.url()).pathname).toMatch(/^\/app\/jobs\/[0-9a-f-]{36}\/candidates$/);
  await expect(page.getByText(/^Ranked by backed score: only evidence that can be inspected counts\./)).toBeVisible();
  await expect(table.getByRole('columnheader')).toHaveText([
    '#',
    'Candidate',
    'Backed score',
    "Meets the job's need",
    'Confidence',
    'Missing critical evidence',
    /^Last scored \(.+\)$/,
    'Next action',
  ]);
  const rows = bodyRows(table);
  await expect(rows).toHaveCount(7);
  await expect(rows.nth(0)).toHaveText(
    '1Sara Al QahtaniNew68up to 84 if claims hold4 of 6HighProduct judgement14 NovNot yet available',
  );
  await expect(rows.nth(1)).toHaveText(/^2Arjun MenonNew64up to 76 if claims hold3 of 6HighRetrieval and evaluation/);
  await expect(rows.nth(2)).toHaveText(/^3Tarek MansourNew63up to 80 if claims hold/);
  await expect(page.getByText(`Showing 7 of 8 assessed. ${FAIRNESS}`)).toBeVisible();
});

test('Scenario: Show all', async ({ page }) => {
  await signIn(page, { email: AP });
  const table = await openCandidates(page);
  await page.getByRole('button', { name: 'Show all 9' }).click();
  const rows = bodyRows(table);
  await expect(rows).toHaveCount(9);
  await expect(rows.nth(7)).toHaveText(/^8Maria SantosNew31up to 69 if claims hold/);
  // Not assessed yet and still listed: nobody drops out of the ranking (AGENTS.md 1.5).
  await expect(rows.nth(8)).toHaveText(/^Youssef AzizNewNot yet scoredNot yet available/);
  await expect(page.getByText(`Showing 8 of 8 assessed. ${FAIRNESS}`)).toBeVisible();
});

test('Scenario: Filter by missing evidence', async ({ page }) => {
  await signIn(page, { email: AP });
  const table = await openCandidates(page);
  await page
    .getByRole('combobox', { name: 'Missing evidence' })
    .selectOption({ label: 'Missing evidence: Retrieval and evaluation' });
  await expect(bodyRows(table)).toHaveText([/^2Arjun Menon/, /^4Layla Haddad/]);
});

test('Scenario: Job without an approved rubric, and no applicants', async ({ page }) => {
  await signIn(page, { email: AP });
  await page.goto('/app/jobs');
  // Senior Product Designer has no applicants (seed.ts); its rubric is a draft, so it opens on the rubric.
  await page.getByRole('link', { name: 'Senior Product Designer' }).click();
  await page.getByRole('link', { name: /^Evidence and ranking/ }).click();
  await expect(page).toHaveTitle('Senior Product Designer: Evidence and ranking · Credalent');
  await expect(page.getByRole('table', { name: 'Ranked candidates' })).toContainText(
    'No ranking yet. Candidates are ranked once the rubric is approved and their evidence is assessed.',
  );
  // People can be brought in before the rubric is approved (AIV-P1-101).
  await expect(page.getByRole('link', { name: 'Add candidates' })).toBeVisible();
  // The stage line in the header says it too; this is the page's own notice, with its link.
  await expect(page.locator('p').filter({ hasText: /^Starts after rubric approval/ })).toBeVisible();
  await page.getByRole('link', { name: 'Send rubric for approval' }).click();
  await expect(page).toHaveURL(/\/rubric$/);
});

test("Scenario: Another workspace's job", async ({ page, context }) => {
  await signIn(page, { email: AP });
  await openCandidates(page);
  const path = new URL(page.url()).pathname;
  await context.clearCookies({ name: '__Host-credalent-session' });
  // Alex runs "Demo Hiring Co", another workspace.
  await signIn(page, { email: 'alex@example.com' });
  expect((await page.goto(path))?.status()).toBe(404);
  await expect(page.getByText('This job does not exist or you do not have access.')).toBeVisible();
  // The page's messages bundle names the table, so check the rendered table and the names, not the words.
  await expect(page.getByRole('table', { name: 'Ranked candidates' })).toHaveCount(0);
  expect(await page.content()).not.toMatch(/Sara Al Qahtani|Arjun Menon/);
});

test('Scenario: The ranking is keyboard operable: search, the filters and Columns', async ({ page }) => {
  await signIn(page, { email: AP });
  const table = await openCandidates(page);
  // The rows have streamed in: loading.tsx's skeleton is gone, so focus stays where it is put.
  await expect(bodyRows(table)).toHaveCount(7);
  await page.getByRole('navigation', { name: 'Stages of this job' }).getByRole('link').last().focus();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('searchbox', { name: 'Search candidates' })).toBeFocused();
  await page.keyboard.type('menon');
  await expect(bodyRows(table)).toHaveText([/^2Arjun Menon/]);
  await page.keyboard.press('Tab');
  await expect(page.getByRole('combobox', { name: 'Stage' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('combobox', { name: 'Missing evidence' })).toBeFocused();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('checkbox', { name: 'Backed score' })).toBeFocused();
  await page.keyboard.press('Space');
  await expect(table.getByRole('columnheader', { name: 'Backed score' })).toHaveCount(0);
});

test('Scenario: "Add candidates" opens Bring in candidates from the ranking with Enter (AIV-P1-101)', async ({
  page,
}) => {
  await signIn(page, { email: AP });
  await expect(await openCandidates(page)).toBeVisible();
  await page.getByRole('link', { name: 'Add candidates' }).focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveTitle('Senior AI Engineer: Bring in candidates · Credalent');
  await expect(page.getByRole('button', { name: 'Upload files' })).toBeVisible();
});

for (const theme of themes) {
  test(`axe passes on the ranked candidates, with the Columns panel open (${theme})`, async ({
    page,
    context,
    baseURL,
  }) => {
    await context.addCookies([{ name: 'theme', value: theme, url: baseURL ?? '' }]);
    await signIn(page, { email: AP });
    await expect(bodyRows(await openCandidates(page))).toHaveCount(7);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await expectAccessible(page);
    await page.getByText('Columns', { exact: true }).click();
    await expect(page.getByRole('checkbox', { name: 'Confidence' })).toBeVisible();
    await expectAccessible(page);
  });

  test(`axe passes on the ranking of a job awaiting its rubric (${theme})`, async ({ page, context, baseURL }) => {
    await context.addCookies([{ name: 'theme', value: theme, url: baseURL ?? '' }]);
    await signIn(page, { email: AP });
    await page.goto('/app/jobs');
    await page.getByRole('link', { name: 'Senior Product Designer' }).click();
    await page.getByRole('link', { name: /^Evidence and ranking/ }).click();
    await expect(page).toHaveTitle('Senior Product Designer: Evidence and ranking · Credalent');
    await expect(page.getByRole('link', { name: 'Send rubric for approval' })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await expectAccessible(page);
  });

  test(`axe passes on the Add applicants dialog (${theme})`, async ({ page, context, baseURL }) => {
    await context.addCookies([{ name: 'theme', value: theme, url: baseURL ?? '' }]);
    await signIn(page, { email: AP });
    await openDialog(page);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await expectAccessible(page);
  });
}
