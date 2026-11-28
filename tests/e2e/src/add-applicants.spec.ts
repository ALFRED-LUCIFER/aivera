import { type Locator, type Page } from '@playwright/test';
import { signIn } from './auth.ts';
import { expect, test } from './csp.ts';
import { expectAccessible, themes } from './gallery.ts';

// AIV-P1-019, AIV-P1-165: the Add CVs dialog, opened by "Add CVs" in the job header over the ranking, as AP, admin of
// "Demo" (seed.ts). This harness has no Blob storage (AZURE_STORAGE_BLOB_URL unset), so no CV is stored here: the
// upload-to-application path is proven against Azurite and PostgreSQL in tests/integration/src/add-applicants.test.ts.
// This spec covers the dialog itself.
const AP = 'ap@example.com';

async function openDialog(page: Page) {
  await page.goto('/app/jobs');
  await page.getByRole('link', { name: 'Senior AI Engineer' }).click();
  // The title streams in after the page commits: waiting for it means axe never reads a page mid-navigation.
  await expect(page).toHaveTitle('Senior AI Engineer: Evidence and ranking · Credalent');
  await page.getByRole('button', { name: 'Add CVs' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add CVs' });
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
    // AIV-P1-165: no source is chosen for the recruiter.
    await expect(dialog.getByRole('radio', { name: 'LinkedIn' })).not.toBeChecked();
    await expect(dialog.getByRole('button', { name: 'Add CVs' })).toBeDisabled();

    const chooser = page.waitForEvent('filechooser');
    await dialog.getByRole('button', { name: 'Choose CV files' }).click();
    // The picker's `accept` only filters the browser's dialog; a file chosen anyway is still refused, by name.
    await (await chooser).setFiles({ ...payload, buffer: Buffer.from(payload.buffer) });
    await expect(
      dialog.getByRole('listitem').filter({ hasText: `${payload.name} · not added: PDF or Word, up to 10 MB.` }),
    ).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Add CVs' })).toBeDisabled();
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
  await expect(dialog.getByRole('button', { name: 'Choose CV files' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('button', { name: 'Add CVs' })).toBeFocused();
});

// AIV-P1-104: the confirmation above the add button. No CV can be stored in this harness, so the button stays disabled for
// that reason too; the batch, its audit entry and the worker guard are proven against PostgreSQL in
// tests/integration/src/intake.test.ts and cv-intake.test.ts.
const CONFIRMATION = 'I am responsible for having the right to process these CVs for Senior AI Engineer.';

test('Scenario: The add button waits for the confirmation: an unticked box, with its hint, from the keyboard', async ({
  page,
}) => {
  await signIn(page, { email: AP });
  const dialog = await openDialog(page);
  const box = dialog.getByRole('checkbox', { name: CONFIRMATION });
  await expect(box).not.toBeChecked();
  const add = dialog.getByRole('button', { name: 'Add CVs' });
  await expect(add).toBeDisabled();
  // AIV-P1-165: the source first, since none is chosen for her.
  await expect(add).toHaveAccessibleDescription('Choose where they came from to add them.');
  await dialog.getByRole('radio', { name: 'Referral' }).check();
  await expect(add).toHaveAccessibleDescription('Confirm the line above to add these CVs.');
  // Source radios, Choose CV files, "From a CSV or Excel file" (AIV-P1-165), then the box: Space ticks it and the hint goes.
  await dialog.getByRole('button', { name: 'Choose CV files' }).focus();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('link', { name: 'From a CSV or Excel file' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(box).toBeFocused();
  await page.keyboard.press('Space');
  await expect(box).toBeChecked();
  await expect(dialog.getByText('Confirm the line above to add these CVs.')).toBeHidden();
  // No consent column and nobody "not yet given": nobody is held back one by one.
  await expect(dialog).not.toContainText('Consent');
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
  // AP, an admin, may choose people for interview (AIV-P1-114), so each row has a selection box.
  await expect(table.getByRole('columnheader')).toHaveText([
    'Select all 7 shown',
    '#',
    'Candidate',
    'Backed score',
    "Meets the job's need",
    'Next action',
  ]);
  const rows = bodyRows(table);
  await expect(rows).toHaveCount(7);
  // AIV-P1-018: Sara's second record merged into hers automatically (seed.ts); AP, an admin, may undo it. Her line is
  // her seeded Round 1, held four days ago (AIV-P2-007), not her intake stage.
  // AIV-P1-165 §9: under the stage, one line on what the rank rests on (ranking-compare-trust.spec.ts reads it word
  // for word); the table opens on four columns, so no "High", missing evidence or date here.
  await expect(rows.nth(0)).toHaveText(
    /^Select Sara Al Qahtani1Sara Al QahtaniRound 1 completeLargest part of the backed score: [^.]+, proven at \d of 5\.1 duplicate mergedUndo merge68up to 84 if claims hold4 of 6Not yet available$/,
  );
  await expect(rows.nth(1)).toHaveText(
    // His seeded Round 2 is three days from today (seed.ts), so its date is a pattern.
    /^Select Arjun Menon2Arjun MenonRound 2 on \d{1,2} \w{3}(Largest part of the backed score: [^.]+\.)?64up to 76 if claims hold3 of 6/,
  );
  await expect(rows.nth(2)).toHaveText(
    /^Select Tarek Mansour3Tarek MansourNew(Largest part of the backed score: [^.]+\.)?63up to 80 if claims hold/,
  );
  await expect(page.getByText(`8 of 9 assessed. ${FAIRNESS}`)).toBeVisible();
});

test('Scenario: Exact duplicates merge automatically: the row shows "1 duplicate merged", and undo previews first', async ({
  page,
}) => {
  await signIn(page, { email: AP });
  const table = await openCandidates(page);
  const sara = bodyRows(table).nth(0);
  await expect(sara.getByText('1 duplicate merged')).toBeVisible();
  // Nine applicants still: the merged record's application joined Sara's, it did not add a row.
  await expect(page.getByRole('button', { name: 'Show all 9' })).toBeVisible();
  await sara.getByRole('button', { name: 'Undo merge' }).click();
  const card = page.getByRole('dialog', { name: 'Preview: undo the merge of Sara Al Qahtani' });
  await expect(card).toContainText('Nothing changes until you confirm.');
  await expect(card.getByRole('button', { name: 'Undo merge' })).toBeDisabled();
  await expectAccessible(page);
  await page.keyboard.press('Escape');
  await expect(card).toBeHidden();
  await expect(sara.getByText('1 duplicate merged')).toBeVisible();
});

test('Scenario: Show all', async ({ page }) => {
  await signIn(page, { email: AP });
  const table = await openCandidates(page);
  await page.getByRole('button', { name: 'Show all 9' }).click();
  const rows = bodyRows(table);
  await expect(rows).toHaveCount(9);
  await expect(rows.nth(7)).toHaveText(
    /^Select Maria Santos8Maria SantosNewLargest part of the backed score: Retrieval and evaluation, proven at 2 of 5\.31up to 69 if claims hold/,
  );
  // Not assessed yet and still listed: nobody drops out of the ranking (AGENTS.md 1.5).
  await expect(rows.nth(8)).toHaveText(/^Select Youssef AzizYoussef AzizNewNot started: no CV was added/);
  await expect(page.getByText(`8 of 9 assessed. ${FAIRNESS}`)).toBeVisible();
});

test('Scenario: Filter by missing evidence', async ({ page }) => {
  await signIn(page, { email: AP });
  const table = await openCandidates(page);
  await page
    .getByRole('combobox', { name: 'Missing evidence' })
    .selectOption({ label: 'Missing evidence: Retrieval and evaluation' });
  await expect(bodyRows(table)).toHaveText([/^Select Arjun Menon2Arjun Menon/, /^Select Layla Haddad4Layla Haddad/]);
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
  await expect(page.getByRole('button', { name: 'Add CVs' })).toBeVisible();
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
  await expect(bodyRows(table)).toHaveText([/^Select Arjun Menon2Arjun Menon/]);
  await page.keyboard.press('Tab');
  await expect(page.getByRole('combobox', { name: 'Stage' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('combobox', { name: 'Missing evidence' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Compare top 3' })).toBeFocused();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('checkbox', { name: 'Backed score' })).toBeFocused();
  await page.keyboard.press('Space');
  await expect(table.getByRole('columnheader', { name: 'Backed score' })).toHaveCount(0);
});

test('Scenario: "Add CVs" opens the dialog over the ranking with Enter (AIV-P1-101, AIV-P1-165)', async ({ page }) => {
  await signIn(page, { email: AP });
  await expect(await openCandidates(page)).toBeVisible();
  const url = page.url();
  await page.getByRole('button', { name: 'Add CVs' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Add CVs' })).toBeVisible();
  expect(page.url()).toBe(url);
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
    await expect(page.getByRole('checkbox', { name: 'Weight on Strong evidence' })).toBeVisible();
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

  test(`axe passes on the Add CVs dialog (${theme})`, async ({ page, context, baseURL }) => {
    await context.addCookies([{ name: 'theme', value: theme, url: baseURL ?? '' }]);
    await signIn(page, { email: AP });
    const dialog = await openDialog(page);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await expectAccessible(page);
    // And with the confirmation ticked.
    await dialog.getByRole('checkbox', { name: CONFIRMATION }).check();
    await expectAccessible(page);
  });
}

// AIV-P1-165 §6: Add CVs is the one entry; the spreadsheet import (AIV-P1-103) is offered from it, and email is not.
test('Scenario: CSV or Excel import is reachable from Add CVs', async ({ page }) => {
  await signIn(page, { email: AP });
  const dialog = await openDialog(page);
  await expect(dialog.getByRole('link', { name: /email/i })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: /email/i })).toHaveCount(0);
  await dialog.getByRole('link', { name: 'From a CSV or Excel file' }).click();
  await expect(page).toHaveURL(/\/app\/jobs\/[0-9a-f-]{36}\/import\/sheet$/);
  await expect(page.getByRole('heading', { name: 'Import from a CSV or Excel file' })).toBeVisible();
});
