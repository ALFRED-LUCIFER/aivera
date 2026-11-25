import { expect, test } from '@playwright/test';
import { signIn } from './auth.ts';
import { css, expectAccessible, focusInView, themes } from './gallery.ts';

// Browser checks handed over from AIV-P0-020 (#52, PR #220) on #57. `/app` needs a session (AIV-P0-009) and runs in
// the signed-in user's active workspace (AIV-P0-010): Alex Recruiter in the synthetic "Demo Hiring Co" (seed.ts).
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

// AIV-P1-081 (owner decision): the sidebar never links out to the website; Settings is followed by Sign out.
test('the sidebar footer has Settings then Sign out and no website link', async ({ page }) => {
  await page.goto('/app');
  const primary = page.getByRole('navigation', { name: 'Primary' });
  await expect(primary.getByRole('link', { name: /website/i })).toHaveCount(0);
  await expect(primary.locator('a[href="/"]')).toHaveCount(0);
  await primary.getByRole('link', { name: 'Settings' }).focus();
  await page.keyboard.press('Tab');
  await expect(primary.getByRole('button', { name: 'Sign out' })).toBeFocused();
  expect(await focusInView(page)).toBe('visible');
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
  // AIV-P1-081: the drawer has no link out to the website either.
  await expect(primary.getByRole('link', { name: /website/i })).toHaveCount(0);
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
    await expectAccessible(page);
    await expect(page).toHaveScreenshot(`shell-desk-${theme}.png`);
  });
}

// AIV-P1-095: the search field and the assistant return with their tickets (AIV-P1-049, AIV-P2-E06).
test('the shell shows built sections only, and no search field or Ask button', async ({ page }) => {
  await page.goto('/app');
  await expect(page.getByRole('navigation', { name: 'Primary' }).getByRole('link')).toHaveText([
    'Credalent',
    /^My desk/,
    /^Jobs/,
    // AIV-P2-002; Demo Hiring Co has no ongoing interview, so no count.
    'Interviews',
    'Settings',
  ]);
  await expect(page.getByRole('searchbox')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Ask Credalent' })).toHaveCount(0);
});

test('a section that is not built answers 404 by direct address, not only by hiding the link', async ({ page }) => {
  for (const section of ['inbox', 'candidates', 'pool', 'packs', 'value']) {
    expect((await page.goto(`/app/${section}`))?.status(), section).toBe(404);
    await expect(page.getByRole('heading', { level: 1, name: 'We could not find that page.' }), section).toBeVisible();
  }
});
