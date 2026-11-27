import { expect, test, type Page } from '@playwright/test';
import { signIn } from './auth.ts';
import { expectAccessible, themes } from './gallery.ts';

// AIV-P1-049: the top-bar search. AP's workspace "Demo" has the seeded jobs and the Senior AI Engineer applicants
// (seed.ts); Nadia's workspace has no jobs. Evidence by meaning is AIV-P1-162 (#662).
const AP = 'ap@example.com';

/** Opens the palette with "/" from the page, as the Gherkin "Keyboard use" does, and types the query. */
async function search(page: Page, query: string) {
  // A key pressed before the page hydrates is lost; the palette's box shows once "/" is handled.
  await expect(async () => {
    await page.locator('body').press('/');
    await expect(page.getByRole('searchbox', { name: 'Search jobs and candidates' })).toBeVisible({ timeout: 1000 });
  }).toPass();
  // Focus is in the box after "/": the keystrokes go wherever focus is.
  await page.keyboard.type(query);
  await expect(page.getByRole('searchbox', { name: 'Search jobs and candidates' })).toHaveValue(query);
  return page.getByRole('dialog', { name: 'Search' });
}

test('Scenario: Find a candidate: "Sara" lists Sara Al Qahtani once, with her job, and opens her profile', async ({
  page,
}) => {
  await signIn(page, { email: AP });
  await page.goto('/app');
  const palette = await search(page, 'Sara');
  const sara = palette.getByRole('link', { name: 'Sara Al Qahtani · Senior AI Engineer' });
  await expect(sara).toHaveCount(1);
  await expect(sara).toHaveAttribute('href', /^\/app\/candidates\/[0-9a-f-]+\?job=[0-9a-f-]+$/);
  await sara.click();
  await expect(page.getByRole('heading', { level: 1, name: 'Sara Al Qahtani' })).toBeVisible();
});

test('Scenario: Keyboard use: "/", "QA", Enter opens QA Automation Engineer', async ({ page }) => {
  await signIn(page, { email: AP });
  await page.goto('/app');
  const palette = await search(page, 'QA');
  await expect(palette.getByRole('link', { name: 'QA Automation Engineer' })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 1, name: 'QA Automation Engineer' })).toBeVisible();
});

test('Scenario: No results', async ({ page }) => {
  await signIn(page, { email: AP });
  await page.goto('/app');
  const palette = await search(page, 'zzzz');
  await expect(palette.getByText('Nothing found for zzzz')).toBeVisible();
  await expect(palette.getByRole('link')).toHaveCount(0);
});

// Workspace isolation is the contracts' (RLS and the repository filter, ADR-005); this proves it on the real database.
test('Scenario: Workspace isolation: another workspace never finds Sara', async ({ page }) => {
  await signIn(page, { email: 'nadia@example.com' });
  await page.goto('/app');
  const palette = await search(page, 'Sara');
  await expect(palette.getByText('Nothing found for Sara')).toBeVisible();
});

for (const theme of themes) {
  test(`axe passes on the search palette with results (${theme})`, async ({ page, context, baseURL }) => {
    await context.addCookies([{ name: 'theme', value: theme, url: baseURL ?? '' }]);
    await signIn(page, { email: AP });
    await page.goto('/app');
    const palette = await search(page, 'a');
    await expect(palette.getByRole('heading', { name: 'Candidates' })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await expectAccessible(page);
  });
}
