import { expect, test, type Page } from '@playwright/test';
import { signIn } from './auth.ts';
import { expectNoAxeViolations, themes } from './gallery.ts';

// AIV-P2-038 (ADR-012): AI token use and the per-workspace daily AI budget in the operator console. seed.ts gives Demo
// Hiring Co 1,500 tokens today (UTC). The budget is changed on Nadia Freelance, whose figures no other spec reads. A
// reused local database holds earlier runs' copies, so rows are found by searching and taking the newest synthetic one.
// "Usage not available" and the server action's 403 are covered where they can be forced: AiTokenUse.test.tsx,
// operator.test.ts and setAiBudget.test.ts. Synthetic people only.

const PIA = 'pia.platform@example.com';
const bounds = 'The budget must be between 100,000 and 10,000,000.';
const reason = 'Pilot cap agreed with the team';

const table = (page: Page) => page.getByRole('table', { name: 'Workspaces' });
const rowOf = (page: Page, name: string) =>
  table(page)
    .getByRole('row')
    .filter({ has: page.getByRole('link', { name, exact: true }), hasText: 'Synthetic' })
    .first();
// The form's own alert, not the router's empty announcer (also role="alert").
const fieldAlert = (page: Page) => page.getByRole('alert').and(page.locator('p'));
/** The definition next to a term in the detail page's lists. */
const fact = (page: Page, term: string) =>
  page
    .getByRole('term')
    .filter({ hasText: new RegExp(`^${term}$`) })
    .locator('xpath=following-sibling::dd[1]');

async function openWorkspace(page: Page, name: string) {
  await signIn(page, { email: PIA });
  expect((await page.goto('/ops/workspaces'))?.status()).toBe(200);
  await page.getByRole('searchbox', { name: 'Search by workspace name' }).fill(name);
  await page.getByRole('searchbox', { name: 'Search by workspace name' }).press('Enter');
  await expect(table(page)).not.toHaveAttribute('aria-busy', 'true');
  return rowOf(page, name);
}

test('Scenario: Use is shown as observed', async ({ page }) => {
  const row = await openWorkspace(page, 'Demo Hiring Co');
  await expect(table(page).getByRole('columnheader').nth(5)).toHaveText('AI tokens today');
  await expect(row.getByRole('cell').nth(5)).toHaveText('1,500Observed');
  await row.getByRole('link').click();

  await expect(page.getByRole('heading', { level: 2, name: 'AI token use' })).toBeVisible();
  await expect(fact(page, 'AI tokens today')).toHaveText('1,500 of 2,000,000Observed');
  await expect(fact(page, 'Daily AI budget')).toHaveText('2,000,000 (platform default)');
  const days = page.getByRole('table', { name: 'AI tokens, last 7 UTC days' }).getByRole('row');
  await expect(days).toHaveCount(8);
  const today = new Date().toISOString().slice(0, 10);
  await expect(days.nth(1).getByRole('cell')).toHaveText([today, '1,500', 'Observed']);
  for (let i = 1; i <= 7; i++) await expect(days.nth(i).getByRole('cell').nth(2)).toHaveText('Observed');
});

test('Scenario: Setting an override, the bounds and a reset, by keyboard', async ({ page }) => {
  await (await openWorkspace(page, 'Nadia Freelance')).getByRole('link').click();
  const budget = page.getByRole('textbox', { name: 'New daily budget (tokens)' });
  const why = page.getByRole('textbox', { name: 'Reason' });
  const inForce = await fact(page, 'Daily AI budget').textContent();

  // Scenario Outline: Bounds: the message, and nothing changes.
  for (const value of ['99,999', '10,000,001']) {
    await budget.fill(value);
    await why.fill(reason);
    await budget.press('Enter');
    await expect(fieldAlert(page)).toHaveText(bounds);
    await expect(budget).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(fact(page, 'Daily AI budget')).toHaveText(inForce ?? '');
  }

  // Setting an override: the shared preview, Cancel focused first, applied only by Confirm.
  await budget.fill('500,000');
  await budget.press('Enter');
  const preview = page.getByRole('dialog', { name: 'Preview: change the daily AI budget' });
  await expect(preview).toContainText(/to 500,000 tokens per UTC day\./);
  await expect(preview).toContainText('Nothing changes until you confirm.');
  await expect(preview.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(preview.getByRole('button', { name: 'Confirm change' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(preview).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: 'Daily AI budget set to 500,000.' })).toBeVisible();
  await expect(fact(page, 'Daily AI budget')).toHaveText('500,000 (set by an operator)');
  await expect(fact(page, 'AI tokens today')).toHaveText(/ of 500,000Observed$/);
  // Both audit entries are written in the change's transaction: tests/integration/src/ai-token-budget.test.ts.

  // Cancel changes nothing.
  await budget.fill('600,000');
  await why.fill(reason);
  await budget.press('Enter');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(budget).toBeFocused();
  await expect(fact(page, 'Daily AI budget')).toHaveText('500,000 (set by an operator)');

  // Reset to the platform default, with a reason.
  await page.getByRole('button', { name: 'Reset to default' }).click();
  await preview.getByRole('button', { name: 'Confirm change' }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Daily AI budget reset to the platform default.' }),
  ).toBeVisible();
  await expect(fact(page, 'Daily AI budget')).toHaveText('2,000,000 (platform default)');
  await expect(page.getByRole('button', { name: 'Reset to default' })).toHaveCount(0);
});

test('a missing reason is refused before the preview', async ({ page }) => {
  await (await openWorkspace(page, 'Nadia Freelance')).getByRole('link').click();
  await page.getByRole('textbox', { name: 'New daily budget (tokens)' }).fill('500,000');
  await page.getByRole('button', { name: 'Preview change' }).click();
  await expect(fieldAlert(page)).toHaveText('Write the reason for this change.');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

for (const theme of themes) {
  test(`axe passes on the AI token use card, its error and its preview (${theme})`, async ({
    page,
    context,
    baseURL,
  }) => {
    await context.addCookies([{ name: 'theme', value: theme, url: baseURL ?? '' }]);
    await (await openWorkspace(page, 'Demo Hiring Co')).getByRole('link').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await expect(page.getByRole('heading', { level: 2, name: 'AI token use' })).toBeVisible();
    await page.getByRole('textbox', { name: 'New daily budget (tokens)' }).fill('99,999');
    await page.getByRole('button', { name: 'Preview change' }).click();
    await expect(fieldAlert(page)).toBeVisible();
    await expectNoAxeViolations(page);
    await page.getByRole('textbox', { name: 'New daily budget (tokens)' }).fill('500,000');
    await page.getByRole('textbox', { name: 'Reason' }).fill(reason);
    // By keyboard, so the pointer does not rest on Confirm (a hover colour mid-transition is not the resting state).
    await page.mouse.move(0, 0);
    await page.getByRole('textbox', { name: 'New daily budget (tokens)' }).press('Enter');
    await expect(page.getByRole('dialog')).toBeVisible();
    await expectNoAxeViolations(page);
    await page.keyboard.press('Escape');
  });
}
