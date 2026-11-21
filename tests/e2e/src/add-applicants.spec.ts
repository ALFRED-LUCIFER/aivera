import { type Page } from '@playwright/test';
import { signIn } from './auth.ts';
import { expect, test } from './csp.ts';
import { expectAccessible, themes } from './gallery.ts';

// AIV-P1-019: "Add applicants" on a job's Candidates tab, as AP, admin of "Demo" (seed.ts). This harness has no Blob
// storage (AZURE_STORAGE_BLOB_URL unset), so no CV is stored here: the upload-to-application path is proven against
// Azurite and PostgreSQL in tests/integration/src/add-applicants.test.ts. This spec covers the dialog itself.
const AP = 'ap@example.com';

async function openDialog(page: Page) {
  await page.goto('/app/jobs');
  // An approved job opens on its Candidates tab. The title streams in after the page commits: waiting for it means axe
  // never reads a page mid-navigation.
  await page.getByRole('link', { name: 'Senior AI Engineer' }).click();
  await expect(page).toHaveURL(/\/candidates$/);
  await expect(page).toHaveTitle('Senior AI Engineer: Evidence and ranking · Credalent');
  await page.getByRole('button', { name: 'Add applicants' }).click();
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
  await expect(page.getByRole('button', { name: 'Add applicants' })).toBeFocused();
});

// AIV-P1-086: seed.ts files three applicants on Senior AI Engineer, received 14 Nov a minute apart (Sara first), as
// "Add applicants" does.
async function openCandidates(page: Page) {
  await page.goto('/app/jobs');
  await page.getByRole('link', { name: 'Senior AI Engineer' }).click();
  await expect(page).toHaveTitle('Senior AI Engineer: Evidence and ranking · Credalent');
  return page.getByRole('table', { name: 'Applicants' });
}

test('Scenario: Applicants appear right after adding them', async ({ page }) => {
  await signIn(page, { email: AP });
  const table = await openCandidates(page);
  // The URL carries the job's opaque id only.
  expect(new URL(page.url()).pathname).toMatch(/^\/app\/jobs\/[0-9a-f-]{36}\/candidates$/);
  await expect(table.getByRole('columnheader')).toHaveText([
    'Candidate',
    /^Received \(.+\)$/,
    'Source',
    'Backed score',
  ]);
  // Newest first, each unscored with its basis, and no invented score.
  await expect(table.getByRole('row').filter({ has: page.getByRole('cell') })).toHaveText([
    'Layla HaddadNew14 NovEmailNot yet scoredNot yet available',
    'Arjun MenonNew14 NovReferralNot yet scoredNot yet available',
    'Sara Al QahtaniNew14 NovLinkedInNot yet scoredNot yet available',
  ]);
  await expect(page.getByText('Ranking orders your attention; nobody is rejected automatically.')).toBeVisible();
});

test('Scenario: Empty job', async ({ page }) => {
  await signIn(page, { email: AP });
  await page.goto('/app/jobs');
  // Senior Product Designer has no applicants (seed.ts); its rubric is a draft, so it opens on the rubric.
  await page.getByRole('link', { name: 'Senior Product Designer' }).click();
  await page.getByRole('link', { name: /^Evidence and ranking/ }).click();
  await expect(page).toHaveTitle('Senior Product Designer: Evidence and ranking · Credalent');
  await expect(page.getByRole('table', { name: 'Applicants' })).toContainText(
    'No ranking yet. Candidates are ranked once the rubric is approved and their evidence is assessed.',
  );
  await expect(page.getByRole('button', { name: 'Add applicants' })).toBeVisible();
});

test('Scenario: The Candidates tab is keyboard operable: from the last stage to "Add applicants"', async ({ page }) => {
  await signIn(page, { email: AP });
  await expect(await openCandidates(page)).toBeVisible();
  await page.getByRole('navigation', { name: 'Stages of this job' }).getByRole('link').last().focus();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Add applicants' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Add applicants' })).toBeVisible();
});

for (const theme of themes) {
  test(`axe passes on the Candidates tab with its applicants (${theme})`, async ({ page, context, baseURL }) => {
    await context.addCookies([{ name: 'theme', value: theme, url: baseURL ?? '' }]);
    await signIn(page, { email: AP });
    await expect((await openCandidates(page)).getByRole('row')).toHaveCount(4);
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
