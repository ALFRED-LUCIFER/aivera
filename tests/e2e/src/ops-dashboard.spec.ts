import { expect, test, type Page } from '@playwright/test';
import { signIn } from './auth.ts';
import { expectAccessible, themes } from './gallery.ts';

// AIV-P2-051: the console home's stat tiles. Other specs add workspaces to the shared database, so counts are matched
// as observed figures here; the exact aggregation, the 80%/100% thresholds, the empty state and a failed read are unit
// and component tests (dashboard.test.ts, OpsDashboard.test.tsx, operator.test.ts). The 403 is ops.spec.ts.
// Synthetic people only (docs/00-product/personas.md).

const PIA = 'pia.platform@example.com';
const tiles = (page: Page) => page.getByRole('region', { name: 'Platform counts' });
const tile = (page: Page, label: string) =>
  tiles(page)
    .locator('div.rounded-card')
    .filter({ has: page.getByText(label, { exact: true }) });

async function openHome(page: Page) {
  await signIn(page, { email: PIA });
  await page.goto('/ops');
  await expect(tiles(page)).toBeVisible();
}

test('Scenario: The dashboard shows observed counts with links', async ({ page }) => {
  await openHome(page);
  for (const label of ['Active', 'Waiting for approval', 'Suspended', 'Not approved'])
    await expect(tile(page, label)).toContainText(new RegExp(`^${label}[\\d,]+Observed`));
  // seed.ts makes Demo Hiring Co spend 1,500 AI tokens today, so the total is an observed figure.
  await expect(tile(page, 'AI tokens today (UTC)')).toContainText(/[\d,]+Observed/);
  await expect(tile(page, 'AI tokens today (UTC)')).toContainText(/\d+ at 80% or more · \d+ at the budget/);
  await expect(tile(page, 'Catalogue version')).toContainText(/Version \d+ live/);

  await page.getByRole('link', { name: 'View approvals' }).click();
  await expect(page).toHaveURL(/\/ops\/approvals$/);
  await page.goto('/ops');
  await page.getByRole('link', { name: 'View suspended workspaces' }).click();
  await expect(page).toHaveURL(/\/ops\/workspaces\?status=suspended$/);
  await expect(page.getByText('Showing only: Suspended.')).toBeVisible();
  // Only suspended workspaces are listed: every row's status cell says so (or the list is empty).
  const statuses = page.getByRole('table', { name: 'Workspaces' }).getByRole('row').locator('td:nth-child(7)');
  for (const text of await statuses.allTextContents()) expect(text).toBe('Suspended');
  await page.getByRole('link', { name: 'Show all workspaces' }).click();
  await expect(page).toHaveURL(/\/ops\/workspaces$/);
});

test('Scenario: AI tokens today against budgets: the tile links to the list sorted by AI tokens today', async ({
  page,
}) => {
  await openHome(page);
  await page.getByRole('link', { name: 'View workspaces by AI use' }).click();
  await expect(page).toHaveURL(/\/ops\/workspaces\?sort=ai$/);
  await expect(page.getByText('Sorted by AI tokens today, most first.')).toBeVisible();
  const tokens = await page
    .getByRole('table', { name: 'Workspaces' })
    .getByRole('row')
    .locator('td:nth-child(6)')
    .allTextContents();
  const figures = tokens.map((t) => Number(t.replace(/\D/g, '') || -1));
  expect(figures).toEqual(figures.toSorted((a, b) => b - a));
});

test('Scenario: The dashboard holds platform metadata only', async ({ page }) => {
  await openHome(page);
  const html = await (await page.request.get('/ops')).text();
  // The shell shows the operator her own email (AIV-P2-052); no other email, name or candidate value.
  expect(html.replaceAll(PIA, '')).not.toMatch(/@example\.com|Demo Hiring Co|Gulf Talent Partners|Sara Al Qahtani/);
});

test('the keyboard path: from the page content through each tile link', async ({ page }) => {
  await openHome(page);
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
  await page.keyboard.press('Enter');
  for (const name of [
    'View active workspaces',
    'View approvals',
    'View suspended workspaces',
    'View workspaces not approved',
    'View workspaces by AI use',
    'Open the catalogue',
  ]) {
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name })).toBeFocused();
  }
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/ops\/catalogue$/);
});

for (const theme of themes) {
  test(`axe passes on the dashboard and the filtered list (${theme})`, async ({ page, context, baseURL }) => {
    await context.addCookies([{ name: 'theme', value: theme, url: baseURL ?? '' }]);
    await openHome(page);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await expectAccessible(page);
    await page.goto('/ops/workspaces?status=active&sort=ai');
    await expect(page.getByText('Showing only: Active.')).toBeVisible();
    await expectAccessible(page);
  });
}
