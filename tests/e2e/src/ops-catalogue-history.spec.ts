import { expect, test } from '@playwright/test';
import { signIn } from './auth.ts';
import { expectAccessible, themes } from './gallery.ts';

// AIV-P2-050 J0: the catalogue version history at /ops/catalogue/versions, read-only. This database holds version 1
// only (version 2 is published in ops-catalogue-publish.spec.ts, which checks its row and diff), so every assertion
// here is about version 1, the last row. playwright.config.ts makes Theo Platform an operator. Synthetic people only.

const THEO = 'theo.platform@example.com';
const SEED_REASON = 'Catalogue version 1 from code (AIV-P1-004, AIV-P1-061)';

test('Scenario: The list shows each version with its reason: the last row is version 1 by System', async ({ page }) => {
  await signIn(page, { email: THEO });
  // From the catalogue page, by keyboard.
  await page.goto('/ops/catalogue');
  await page.getByRole('link', { name: 'Version history' }).focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL('/ops/catalogue/versions');
  await expect(page).toHaveTitle('Catalogue versions');
  const table = page.getByRole('table', { name: 'Published catalogue versions' });
  await expect(table.getByRole('columnheader', { name: 'Published (Asia/Dubai)' })).toBeVisible();
  const last = table.getByRole('row').last();
  await expect(last).toContainText('Version 1');
  await expect(last).toContainText('System');
  await expect(last).toContainText(SEED_REASON);
  await expect(last).toContainText('First version');
  await expect(last).toContainText('No eval run');
  await expect(last).toContainText(/\d{1,2} \w{3} \d{4} \d{2}:\d{2}/);

  // Scenario: A version's detail, read-only: version 1 has nothing before it and no edit controls.
  await last.getByRole('link', { name: 'Version 1' }).focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL('/ops/catalogue/versions/1');
  await expect(page.getByRole('heading', { level: 1, name: 'Catalogue version 1' })).toBeVisible();
  await expect(page.getByRole('main')).toContainText('First version: the catalogue as it was in code');
  await expect(page.getByRole('heading', { level: 2, name: 'Job types · version 1' })).toBeVisible();
  await expect(page.getByRole('main').getByRole('button')).toHaveCount(0);
  await expect(page.getByRole('main').getByRole('textbox')).toHaveCount(0);
});

test('Scenario Outline: States: version 99 is missing', async ({ page }) => {
  await signIn(page, { email: THEO });
  // Streamed after loading.tsx, so the response is already 200; the page is the not-found copy.
  await page.goto('/ops/catalogue/versions/99');
  await expect(page.getByText('This catalogue version does not exist.')).toBeVisible();
});

// SAFETY: mutation check: removed `await platformOperator()` from the /ops layout, both history pages and their reads in server/operator.ts -> this test failed (200)
test('Scenario: Only operators can read the history: Riya gets 403', async ({ page }) => {
  // Alex, the e2e seed's recruiter, plays Riya.
  await signIn(page, { email: 'alex@example.com' });
  for (const path of ['/ops/catalogue/versions', '/ops/catalogue/versions/1']) {
    const response = await page.goto(path);
    expect(response?.status()).toBe(403);
    expect(await response?.text()).not.toContain(SEED_REASON);
  }
});

for (const theme of themes) {
  test(`axe passes on the list and a version (${theme})`, async ({ page, context, baseURL }) => {
    await context.addCookies([{ name: 'theme', value: theme, url: baseURL ?? '' }]);
    await signIn(page, { email: THEO });
    await page.goto('/ops/catalogue/versions');
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await expect(page.getByRole('table')).toBeVisible();
    await expectAccessible(page);
    await page.goto('/ops/catalogue/versions/1');
    await expect(page.getByRole('heading', { level: 1, name: 'Catalogue version 1' })).toBeVisible();
    await expectAccessible(page);
  });
}
