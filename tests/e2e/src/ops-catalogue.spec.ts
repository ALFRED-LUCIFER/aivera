import { expect, test, type Page } from '@playwright/test';
import { signIn } from './auth.ts';
import { expectAccessible, themes } from './gallery.ts';

// AIV-P5-015 (ADR-012): the read-only catalogue of job types and domain packs at /ops/catalogue, from the jobs
// contracts. playwright.config.ts makes Pia Platform an operator. Synthetic people only (docs/00-product/personas.md).

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

const packSummary = (page: Page, name: string) => page.locator('main summary').filter({ hasText: name }).first();
const pack = (page: Page, name: string) =>
  page
    .locator('main details')
    .filter({ has: page.locator('summary').filter({ hasText: name }) })
    .first();

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
  await expect(jobTypes.getByRole('row').filter({ hasText: 'Software engineering' })).toContainText(
    'System design in production',
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
  await expect(payments.locator('summary').filter({ hasText: 'Software engineering' })).toBeHidden();
  await openPaymentsForSoftwareEngineering(page);
  const swe = payments.locator('details').filter({ hasText: 'Software engineering' }).first();
  await expect(swe.locator('summary')).toContainText(/\d+ competenc(y|ies)/);
  const competency = swe.getByRole('listitem').filter({
    has: page.getByRole('heading', { name: 'Idempotent payment APIs and retries' }),
  });
  await expect(swe.getByRole('heading', { level: 3, name: 'Default suggestions' })).toBeVisible();
  await expect(competency).toContainText('Evidence that counts');
  await expect(competency).toContainText('Code with idempotency keys and retry tests');
  await expect(competency).toContainText('Level 1Has called a payment API and handled declines');
  await expect(competency).toContainText('Level 3');
  await expect(competency).toContainText('Level 5');
  await expect(competency).toContainText('Desirable');
  await expect(competency).toContainText('Level 3 needed');
  for (const region of ['Regional hints for the UAE', 'Regional hints for KSA', 'Regional hints for India']) {
    const group = swe.locator('section').filter({ has: page.getByRole('heading', { level: 3, name: region }) });
    await expect(group.getByRole('listitem').first()).toContainText('Desirable');
    await expect(group.getByRole('listitem').first()).toContainText('Evidence that counts');
  }
});

test('Scenario: Nothing can be edited here', async ({ page }) => {
  await openCatalogue(page);
  await openPaymentsForSoftwareEngineering(page);
  await expect(page.locator('main').locator('button, input, textarea, select, form, [contenteditable]')).toHaveCount(0);
  await expect(page.getByText('The catalogue changes only through a reviewed pull request.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Catalogue migrations on GitHub' })).toHaveAttribute(
    'href',
    /\/modules\/jobs\/src\/infrastructure\/migrations$/,
  );
});

// SAFETY: mutation check: removed `await platformOperator()` from the /ops layout and the catalogue page -> this test failed (200)
test('Scenario: Non-operators are refused', async ({ page }) => {
  await signIn(page, { email: 'alex@example.com' });
  const response = await page.goto('/ops/catalogue');
  expect(response?.status()).toBe(403);
  await expect(page.getByText('You do not have access to this. Ask your workspace admin.')).toBeVisible();
  expect(await response?.text()).not.toMatch(/Payments and fintech|Job types · version|reviewed pull request/);
});

test('the keyboard path: from the source link into a pack and a job type', async ({ page }) => {
  await openCatalogue(page);
  await page.getByRole('link', { name: 'Catalogue migrations on GitHub' }).focus();
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
