import { expect, test } from '@playwright/test';
import { expectAccessible, themes } from './gallery.ts';

// AIV-P3-001, journey J5 step 1. Signed out only: the signed-in header ("My applications") is proven by
// candidate-sign-in.spec.ts (AIV-P0-011) and CandidateSite.test.tsx.
const home = '/candidates';
const siteNav = (page: import('@playwright/test').Page) => page.getByRole('navigation', { name: 'Candidate site' });
// The home page's hero fades in (about 1.4 s); reduced motion shows it settled, so axe never measures text mid-fade.
test.use({ reducedMotion: 'reduce' });

test('a signed-out visitor sees the candidate navigation and footer, and no recruiter chrome', async ({ page }) => {
  await page.goto(home);
  const header = page.getByRole('banner');
  await expect(header.getByRole('link', { name: /^Credalent for candidates/ })).toBeVisible();
  // Only built pages are linked (AIV-P1-095): no CV check, Plans, Portfolio or Apply.
  await expect(siteNav(page).getByRole('link')).toHaveText(['Jobs', 'Create account']);
  await expect(page.getByRole('link', { name: 'My applications' })).toHaveCount(0);

  const footer = page.getByRole('contentinfo');
  await expect(footer).toContainText('© Credalent. Paying never changes how recruiters rank you.');
  await expect(footer.getByRole('link')).toHaveText(['Jobs', 'For recruiters']);

  await expect(page.getByRole('button', { name: 'Ask Credalent' })).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Primary' })).toHaveCount(0);
});

// AIV-P1-095: a page that is not built is not served, and none says "arrives with its own ticket".
test('pages that are not built answer 404', async ({ page }) => {
  for (const path of ['/candidates/plans', '/candidates/cv-check', '/candidates/plus/address', '/candidates/nowhere']) {
    expect((await page.goto(path))?.status(), path).toBe(404);
    await expect(page.getByRole('heading', { level: 1, name: 'We could not find that page.' })).toBeVisible();
    await expect(page.getByText('arrives with its own ticket')).toHaveCount(0);
  }
});

test('Skip to content is the first focusable element and moves focus to main', async ({ page }) => {
  await page.goto(home);
  await page.keyboard.press('Tab');
  const skip = page.getByRole('link', { name: 'Skip to content' });
  await expect(skip).toBeFocused();
  await expect(skip).toBeInViewport();
  await page.keyboard.press('Enter');
  await expect(page.locator('main#content')).toBeFocused();
});

test('at 375 px the links sit behind a Menu button that opens and closes with the keyboard', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(home);
  await expect(siteNav(page)).toBeHidden();
  const menu = page.getByRole('button', { name: 'Menu' });
  // Retried until React has hydrated: before that, Enter reaches a button with no handler yet (next dev).
  await expect(async () => {
    await menu.focus();
    await page.keyboard.press('Enter');
    await expect(menu).toHaveAttribute('aria-expanded', 'true', { timeout: 500 });
  }).toPass();
  await expect(siteNav(page).getByRole('link', { name: 'Jobs' })).toBeFocused();
  // No horizontal scroll with the menu open, the widest state.
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  await expectAccessible(page);
  await page.keyboard.press('Escape');
  await expect(siteNav(page)).toBeHidden();
  await expect(menu).toBeFocused();
});

for (const theme of themes) {
  test(`axe passes on the candidate layout (${theme})`, async ({ page, context }) => {
    await context.addCookies([{ name: 'theme', value: theme, url: 'http://localhost:3200' }]);
    await page.goto(home);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await expectAccessible(page);
  });
}
