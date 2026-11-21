import { createDb } from '@credalent/db/client';
import { expect, test, type Page } from '@playwright/test';
import { sql } from 'drizzle-orm';
import { databaseUrl } from '../playwright.config.ts';
import { signIn } from './auth.ts';
import { expectAccessible, themes } from './gallery.ts';

// AIV-P5-015 (ADR-012): the catalogue at /ops/catalogue. AIV-P2-045 (ADR-013): with no draft it is read-only with
// "Start a draft"; with one, operators add, edit and retire packs and competencies. playwright.config.ts makes Pia
// Platform an operator. Synthetic people and catalogue text only (docs/00-product/personas.md).
//
// One draft at a time across the whole database, so this file runs in order and starts with none: the draft of an
// earlier run is discarded here (the discard screen is AIV-P2-049).
test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  const db = createDb(databaseUrl, { max: 1 });
  try {
    await db.transaction(async (tx) => {
      for (const table of ['regional_hint', 'pack_competency', 'pack', 'region', 'job_type'])
        await tx.execute(
          sql`delete from ${sql.identifier('jobs')}.${sql.identifier(`catalogue_${table}`)} where version in
            (select version from jobs.catalogue_version where status = 'draft')`,
        );
      await tx.execute(sql`delete from jobs.catalogue_version where status = 'draft'`);
    });
  } finally {
    await db.$client.end();
  }
});

const PIA = 'pia.platform@example.com';
const PACKS = [
  'Payments and fintech',
  'Banking and Islamic finance',
  'Healthcare',
  'E-commerce and marketplaces',
  'Logistics and mobility',
  'Government and public sector',
  'Telecom',
  'Energy and utilities',
];
const LEDGER = 'Ledger and double-entry accounting';

const packSummary = (page: Page, name: string) => page.locator('main summary').filter({ hasText: name }).first();
const pack = (page: Page, name: string) =>
  page
    .locator('main details')
    .filter({ has: page.locator('summary').filter({ hasText: name }) })
    .first();
const competency = (page: Page, name: string) =>
  page.locator('main details li').filter({ has: page.getByRole('heading', { level: 3, name, exact: true }) });

async function openCatalogue(page: Page) {
  await signIn(page, { email: PIA });
  const response = await page.goto('/ops/catalogue');
  expect(response?.status()).toBe(200);
  await expect(page.getByRole('heading', { level: 1, name: 'Catalogue' })).toBeVisible();
}

async function openPaymentsForSoftwareEngineering(page: Page) {
  await packSummary(page, 'Payments and fintech').click();
  await pack(page, 'Payments and fintech').locator('summary').filter({ hasText: 'Software engineering' }).click();
}

test.describe('no draft: the published version', () => {
  test('Scenario: Job types and packs are listed with versions', async ({ page }) => {
    await openCatalogue(page);
    await expect(page).toHaveTitle('Catalogue');
    await expect(
      page.getByRole('navigation', { name: 'Operations' }).getByRole('link', { name: 'Catalogue' }),
    ).toBeVisible();
    const jobTypes = page.getByRole('table');
    await expect(page.getByRole('heading', { level: 2, name: 'Job types · version 1' })).toBeVisible();
    await expect(jobTypes.getByRole('rowheader')).toHaveCount(10);
    await expect(jobTypes.getByRole('row').filter({ hasText: 'Software engineering' })).toContainText(
      'Repositories, shipped products, code reviews',
    );
    await expect(page.getByRole('heading', { level: 2, name: 'Domain packs · version 1' })).toBeVisible();
    const summaries = page.locator('main > * details:not(details details) > summary');
    await expect(summaries).toHaveCount(8);
    for (const [i, name] of PACKS.entries()) {
      await expect(summaries.nth(i)).toContainText(name);
      await expect(summaries.nth(i)).toContainText(/Version 1 · \d+ job types?/);
    }
  });

  test('Scenario: A pack shows its competencies per job type', async ({ page }) => {
    await openCatalogue(page);
    const payments = pack(page, 'Payments and fintech');
    await openPaymentsForSoftwareEngineering(page);
    const swe = payments.locator('details').filter({ hasText: 'Software engineering' }).first();
    const entry = swe.getByRole('listitem').filter({
      has: page.getByRole('heading', { name: 'Idempotent payment APIs and retries' }),
    });
    await expect(swe.getByRole('heading', { level: 3, name: 'Default suggestions' })).toBeVisible();
    await expect(entry).toContainText('Code with idempotency keys and retry tests');
    await expect(entry).toContainText('Level 1Has called a payment API and handled declines');
    await expect(entry).toContainText('Desirable');
    await expect(entry).toContainText('Level 3 needed');
    for (const region of ['Regional hints for the UAE', 'Regional hints for KSA', 'Regional hints for India']) {
      const group = swe.locator('section').filter({ has: page.getByRole('heading', { level: 3, name: region }) });
      await expect(group.getByRole('listitem').first()).toContainText('Evidence that counts');
    }
  });

  test('Scenario Outline: Page states: no draft exists', async ({ page }) => {
    await openCatalogue(page);
    await expect(page.getByText('Recruiters see version 1. Start a draft to change it.')).toBeVisible();
    // Nothing here edits the published version: the one control is "Start a draft".
    await openPaymentsForSoftwareEngineering(page);
    await expect(page.locator('main').locator('button, input, textarea, select, form, [contenteditable]')).toHaveCount(
      1,
    );
    await expect(page.getByRole('button', { name: 'Start a draft' })).toBeVisible();
  });

  // SAFETY: mutation check: removed `await platformOperator()` from the /ops layout and the catalogue page -> this test failed (200)
  test('Scenario: Non-operators are refused', async ({ page }) => {
    await signIn(page, { email: 'alex@example.com' });
    const response = await page.goto('/ops/catalogue');
    expect(response?.status()).toBe(403);
    await expect(page.getByText('You do not have access to this. Ask your workspace admin.')).toBeVisible();
    expect(await response?.text()).not.toMatch(/Payments and fintech|Job types · version|Start a draft/);
  });

  test('the keyboard path: from "Start a draft" into a pack and a job type', async ({ page }) => {
    await openCatalogue(page);
    await page.getByRole('button', { name: 'Start a draft' }).focus();
    await page.keyboard.press('Tab');
    await expect(packSummary(page, 'Payments and fintech')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(pack(page, 'Payments and fintech')).toHaveAttribute('open', '');
    await page.keyboard.press('Tab');
    const swe = pack(page, 'Payments and fintech').locator('summary').filter({ hasText: 'Software engineering' });
    await expect(swe).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'Idempotent payment APIs and retries' })).toBeVisible();
  });

  for (const theme of themes) {
    test(`axe passes on the catalogue with a pack open (${theme})`, async ({ page, context, baseURL }) => {
      await context.addCookies([{ name: 'theme', value: theme, url: baseURL ?? '' }]);
      await openCatalogue(page);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await openPaymentsForSoftwareEngineering(page);
      await expect(page.getByRole('heading', { name: 'Idempotent payment APIs and retries' })).toBeVisible();
      await expectAccessible(page);
    });
  }
});

test.describe('the draft', () => {
  test('Scenario: Starting a draft copies the published version', async ({ page }) => {
    await openCatalogue(page);
    await page.getByRole('button', { name: 'Start a draft' }).click();
    await expect(page.getByText('Draft — not live. Recruiters see version 1.')).toBeVisible();
    const summaries = page.locator('main details > summary');
    await expect(summaries).toHaveCount(8);
    for (const [i, name] of PACKS.entries()) {
      await expect(summaries.nth(i)).toContainText(name);
      await expect(summaries.nth(i)).toContainText('Live');
    }
    await page.goto('/ops/audit');
    await expect(page.getByRole('row').filter({ hasText: 'Catalogue draft opened' }).first()).toContainText(
      'pia.platform',
    );
  });

  test('Scenario: Adding a pack and a competency, by keyboard', async ({ page }) => {
    await openCatalogue(page);
    await page.getByRole('button', { name: 'Add a pack' }).focus();
    await page.keyboard.press('Enter');
    const packDialog = page.getByRole('dialog', { name: 'Add a pack' });
    await expect(packDialog.getByLabel('Key')).toBeFocused();
    await page.keyboard.type('insurance');
    await page.keyboard.press('Tab');
    await page.keyboard.type('Insurance and insurtech');
    await page.keyboard.press('Enter');
    await expect(packDialog).toBeHidden();
    const insurance = packSummary(page, 'Insurance and insurtech');
    await expect(insurance).toContainText('New in draft');

    await insurance.click();
    await page.getByRole('button', { name: 'Add a competency to Insurance and insurtech' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add a competency' });
    await dialog.getByLabel('Name').fill('Claims processing systems');
    await dialog.getByLabel('What it means').fill('Builds and runs the systems that take a claim to payment.');
    await dialog
      .getByLabel('Evidence that counts')
      .fill('Claims workflow code and tests; incident reviews of claim errors');
    for (const level of [1, 3, 5])
      await dialog.getByRole('textbox', { name: `Level ${level}` }).fill(`Claims work at level ${level}`);
    await dialog.getByRole('group', { name: 'Default suggestion for' }).getByLabel('Software engineering').check();
    await expect(
      dialog.getByRole('group', { name: 'Applies to job types' }).getByLabel('Software engineering'),
    ).toBeChecked();
    await expect(dialog.getByRole('radio', { name: 'Level 3' })).toBeChecked();
    await expect(dialog).toContainText('Desirable');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog).toBeHidden();
    await expect(competency(page, 'Claims processing systems')).toContainText('New in draft');
    await expect(competency(page, 'Claims processing systems')).toContainText(
      'Default suggestion for Software engineering',
    );
  });

  test('Scenario Outline: Fairness is enforced on save', async ({ page }) => {
    await openCatalogue(page);
    await packSummary(page, 'Insurance and insurtech').click();
    await page.getByRole('button', { name: 'Add a competency to Insurance and insurtech' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add a competency' });
    await dialog.getByLabel('Name').fill('Worked at a top insurer');
    await dialog.getByLabel('What it means').fill('Has the right background.');
    await dialog.getByLabel('Evidence that counts').fill('Employment history');
    for (const level of [1, 3, 5]) await dialog.getByRole('textbox', { name: `Level ${level}` }).fill('Any');
    await dialog.getByRole('group', { name: 'Applies to job types' }).getByLabel('Software engineering').check();
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog.getByRole('alert')).toHaveText('A competency is a skill with evidence, never an employer.');
    await expect(dialog.getByLabel('Name')).toHaveAttribute('aria-invalid', 'true');
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(competency(page, 'Worked at a top insurer')).toHaveCount(0);
  });

  test('Scenario: A published competency is retired, never deleted', async ({ page }) => {
    await openCatalogue(page);
    await packSummary(page, 'Payments and fintech').click();
    await expect(page.getByRole('button', { name: `Remove ${LEDGER}` })).toHaveCount(0);
    await page.getByRole('button', { name: `Retire ${LEDGER}` }).click();
    await expect(competency(page, LEDGER)).toContainText('Retired');
    await expect(competency(page, LEDGER).getByRole('button')).toHaveCount(0);
  });

  for (const theme of themes) {
    test(`axe passes on the draft and its competency form (${theme})`, async ({ page, context, baseURL }) => {
      await context.addCookies([{ name: 'theme', value: theme, url: baseURL ?? '' }]);
      await openCatalogue(page);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await packSummary(page, 'Insurance and insurtech').click();
      await expectAccessible(page);
      await page.getByRole('button', { name: 'Edit Claims processing systems' }).click();
      await expect(page.getByRole('dialog', { name: 'Edit competency' })).toBeVisible();
      await expectAccessible(page);
    });
  }
});

// AIV-P2-046: a pack's regional hints in the draft. Runs after "the draft" above, on the draft it opened.
const LOGISTICS = 'Logistics and mobility';
const FREE_ZONE = 'UAE customs and free-zone procedures';
const region = (page: Page, heading: string) =>
  pack(page, LOGISTICS)
    .locator('section')
    .filter({ has: page.getByRole('heading', { level: 3, name: heading }) });
const hint = (page: Page, name: string) =>
  page.locator('main details section li').filter({ has: page.getByRole('heading', { level: 3, name, exact: true }) });

/** Fills the hint form; the name too when given. */
async function fillHint(page: Page, name?: string) {
  const dialog = page.getByRole('dialog', { name: 'Add a regional hint' });
  if (name) await dialog.getByLabel('Name').fill(name);
  await dialog.getByLabel('What it means').fill('Integrates customs clearance with the FASAH platform.');
  await dialog.getByLabel('Evidence that counts').fill('Integration code and tests against FASAH documents');
  for (const level of [1, 3, 5])
    await dialog.getByRole('textbox', { name: `Level ${level}` }).fill(`Customs work at level ${level}`);
  await dialog.getByRole('group', { name: 'Applies to job types' }).getByLabel('Software engineering').check();
  await dialog.getByRole('radio', { name: 'Level 2' }).check();
  return dialog;
}

test.describe('regional hints in the draft', () => {
  test('Scenario: Adding a hint, by keyboard', async ({ page }) => {
    await openCatalogue(page);
    await packSummary(page, LOGISTICS).click();
    await expect(region(page, 'Regional hints for the UAE')).toBeVisible();
    await expect(region(page, 'Regional hints for India')).toBeVisible();
    await page.getByRole('button', { name: `Add a regional hint to ${LOGISTICS} for KSA` }).focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Add a regional hint' });
    await expect(dialog.getByLabel('Name')).toBeFocused();
    await page.keyboard.type('FASAH customs integration');
    await expect(dialog.getByLabel('Name')).toHaveValue('FASAH customs integration');
    await fillHint(page);
    // Always Desirable: no Mandatory option and no default suggestions.
    await expect(dialog).toContainText('Desirable');
    for (const role of ['radio', 'checkbox', 'option', 'combobox'] as const)
      await expect(dialog.getByRole(role, { name: /mandatory/i })).toHaveCount(0);
    await expect(dialog.getByRole('group', { name: 'Default suggestion for' })).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Save' }).focus();
    await page.keyboard.press('Enter');
    await expect(dialog).toBeHidden();
    const added = hint(page, 'FASAH customs integration');
    await expect(added).toContainText('New in draft');
    await expect(added).toContainText('Desirable');
    await expect(region(page, 'Regional hints for KSA')).toContainText('FASAH customs integration');
    // Newest first: the hint's own entry is the top row.
    await page.goto('/ops/audit');
    const newest = page.getByRole('row').nth(1);
    await expect(newest).toContainText('Catalogue entry added');
    await expect(newest).toContainText('pia.platform');
  });

  test('Scenario Outline: A hint is a skill, never a residency rule', async ({ page }) => {
    await openCatalogue(page);
    await packSummary(page, LOGISTICS).click();
    await page.getByRole('button', { name: `Add a regional hint to ${LOGISTICS} for KSA` }).click();
    const dialog = await fillHint(page, 'Must hold a UAE residence visa');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog.getByRole('alert')).toHaveText(
      'A regional hint is market knowledge shown with evidence, never where someone lives or is from.',
    );
    await expect(dialog.getByLabel('Name')).toHaveAttribute('aria-invalid', 'true');
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(hint(page, 'Must hold a UAE residence visa')).toHaveCount(0);
  });

  test('Scenario: A published hint is retired, not deleted', async ({ page }) => {
    await openCatalogue(page);
    await packSummary(page, LOGISTICS).click();
    await expect(page.getByRole('button', { name: `Remove ${FREE_ZONE}` })).toHaveCount(0);
    await page.getByRole('button', { name: `Retire ${FREE_ZONE}` }).click();
    await expect(hint(page, FREE_ZONE)).toContainText('Retired');
    await expect(hint(page, FREE_ZONE).getByRole('button')).toHaveCount(0);
  });

  for (const theme of themes) {
    test(`axe passes on a pack's hints and the hint form (${theme})`, async ({ page, context, baseURL }) => {
      await context.addCookies([{ name: 'theme', value: theme, url: baseURL ?? '' }]);
      await openCatalogue(page);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await packSummary(page, LOGISTICS).click();
      await expectAccessible(page);
      await page.getByRole('button', { name: 'Edit FASAH customs integration' }).click();
      await expect(page.getByRole('dialog', { name: 'Edit regional hint' })).toBeVisible();
      await expectAccessible(page);
    });
  }
});
