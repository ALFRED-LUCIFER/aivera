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

for (const theme of themes) {
  test(`axe passes on the Add applicants dialog (${theme})`, async ({ page, context, baseURL }) => {
    await context.addCookies([{ name: 'theme', value: theme, url: baseURL ?? '' }]);
    await signIn(page, { email: AP });
    await openDialog(page);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await expectAccessible(page);
  });
}
