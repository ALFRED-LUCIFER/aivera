import { expect, test, type Page } from '@playwright/test';
import { expectNoAxeViolations, themes } from './gallery.ts';

// AIV-P3-004, journey J5 step 3: the public jobs list over the five synthetic jobs published by seed.ts, signed out.
const chips = (page: Page) => page.getByRole('radiogroup', { name: 'Filter jobs' });
const titles = (page: Page) => page.getByRole('listitem').getByRole('heading', { level: 2 });

test('the list shows every published job with counts, and a card says who, what and when', async ({ page }) => {
  await page.goto('/candidates/jobs');
  await expect(
    page.getByText('Posted by recruiters who hire on evidence. Every listing shows what the job needs.'),
  ).toBeVisible();
  for (const name of ['All 5', 'Engineering 3', 'Product 1', 'Sales 1', 'Dubai 5'])
    await expect(chips(page).getByRole('radio', { name })).toBeAttached();
  const card = page.getByRole('listitem').filter({ hasText: 'Real Estate Sales Consultant' });
  await expect(card).toContainText('A property brokerage · Dubai');
  await expect(card).toContainText('Sales');
  await expect(card).toContainText('Posted 2 days ago');
  await expect(card.getByRole('link', { name: 'View job: Real Estate Sales Consultant' })).toHaveAttribute(
    'href',
    /^\/candidates\/jobs\/real-estate-sales-consultant-[0-9a-f]{12}$/,
  );
  await expect(page.getByText(/You meet/)).toHaveCount(0);
  await expect(page.getByRole('contentinfo')).toContainText('Paying never changes how recruiters rank you.');
});

test('a chip chosen with the keyboard filters the list and keeps the filter in the URL', async ({ page }) => {
  await page.goto('/candidates/jobs');
  // Retried until React has hydrated: before that, the arrow key moves a radio with no handler yet (next dev).
  await expect(async () => {
    await chips(page).getByRole('radio', { name: 'All 5' }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(page).toHaveURL(/filter=engineering/, { timeout: 1_000 });
  }).toPass();
  await expect(titles(page)).toHaveCount(3);
  await page.reload();
  await expect(titles(page)).toHaveCount(3);
  await expect(chips(page).getByRole('radio', { name: 'Engineering 3' })).toBeChecked();
});

test('searching by title, and a search with no results', async ({ page }) => {
  await page.goto('/candidates/jobs');
  await page.getByRole('searchbox', { name: 'Job title or skill' }).fill('QA');
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(page).toHaveURL(/q=QA/);
  await expect(titles(page)).toHaveText(['QA Automation Engineer']);

  await page.goto('/candidates/jobs?q=Pastry+chef');
  await expect(page.getByText('No jobs match. Try a different word or clear the filters.')).toBeVisible();
  await page.getByRole('link', { name: 'Clear filters' }).click();
  await expect(page).toHaveURL(/\/candidates\/jobs$/);
  await expect(titles(page)).toHaveCount(5);
});

for (const theme of themes) {
  test(`axe passes on the jobs list (${theme})`, async ({ page, context }) => {
    await context.addCookies([{ name: 'theme', value: theme, url: 'http://localhost:3200' }]);
    await page.goto('/candidates/jobs');
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await expect(titles(page)).toHaveCount(5);
    await expectNoAxeViolations(page);
  });
}
