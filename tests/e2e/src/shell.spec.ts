import { expect, test } from '@playwright/test';
import { signIn } from './auth.ts';
import { css, expectNoAxeViolations, themes } from './gallery.ts';

// Browser checks handed over from AIV-P0-020 (#52, PR #220) on #57. `/app` renders only under `next dev`, as the
// synthetic stand-in recruiter (devStandInMember), which is what the webServer runs, and needs a session (AIV-P0-009).
test.beforeEach(({ page }) => signIn(page));

const nav = (name: RegExp) => ({ name });

for (const [path, heading, link] of [
  ['/app', 'My desk', /^My desk/],
  ['/app/jobs', 'Jobs', /^Jobs/],
] as const) {
  test(`the shell renders on ${heading} (${path})`, async ({ page }) => {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Primary' }).getByRole('link', nav(link))).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(page.getByRole('button', { name: 'Ask Aivera' })).toBeVisible();
  });
}

// mutation check: hard-coded data-theme="light" in the root layout -> this test failed
test('the theme persists across a reload with no flash', async ({ page, context }) => {
  await page.goto('/app');
  await page.getByRole('button', { name: 'Switch to dark theme' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect.poll(async () => (await context.cookies()).find((c) => c.name === 'theme')?.value).toBe('dark');
  const response = await page.reload();
  // No flash: the server's first HTML already carries the dark theme, before any script runs.
  expect(await response?.text()).toMatch(/<html[^>]*data-theme="dark"/);
  await expect.poll(() => css(page.locator('body'), 'background-color')).toBe('rgb(20, 17, 24)'); // #141118
  await expect(page.getByRole('button', { name: 'Switch to light theme' })).toBeVisible();
});

// mutation check: pointed the skip link at #nowhere -> this test failed
test('the skip link moves focus to main', async ({ page }) => {
  await page.goto('/app');
  await page.keyboard.press('Tab');
  const skip = page.getByRole('link', { name: 'Skip to content' });
  await expect(skip).toBeFocused();
  await expect(skip).toBeInViewport();
  await page.keyboard.press('Enter');
  await expect(page.locator('main#content')).toBeFocused();
});

test('the sidebar collapses at 768 px behind "Open navigation"', async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.goto('/app');
  const primary = page.getByRole('navigation', { name: 'Primary' });
  await expect(primary).toBeHidden();
  const menu = page.getByRole('button', { name: 'Open navigation' });
  await expect(menu).toHaveAttribute('aria-expanded', 'false');
  await menu.click();
  await expect(primary).toBeVisible();
  // The opened menu takes focus on its first section link; Escape closes it and returns focus to the button.
  await expect(primary.getByRole('link', nav(/^My desk/))).toBeFocused();
  await expect(page).toHaveScreenshot('shell-menu-open-768.png');
  await page.keyboard.press('Escape');
  await expect(primary).toBeHidden();
  await expect(page.getByRole('button', { name: 'Open navigation' })).toBeFocused();
});

for (const theme of themes) {
  test(`axe passes on the shell (${theme})`, async ({ page, context }) => {
    await context.addCookies([{ name: 'theme', value: theme, url: 'http://localhost:3200' }]);
    await page.goto('/app');
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await expectNoAxeViolations(page);
    await expect(page).toHaveScreenshot(`shell-desk-${theme}.png`);
  });
}
