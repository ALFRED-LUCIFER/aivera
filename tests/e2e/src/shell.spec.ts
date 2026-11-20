import { expect, test } from '@playwright/test';
import { signIn } from './auth.ts';
import { css, expectAccessible, focusInDrawer, focusInView, themes } from './gallery.ts';

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
    await expect(page.getByRole('button', { name: 'Ask Credalent' })).toBeVisible();
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
    await expectAccessible(page);
    await expect(page).toHaveScreenshot(`shell-desk-${theme}.png`);
  });
}

// AIV-P0-920: from lg up the assistant drawer sits beside the page; "Ask Credalent" is top right, where the drawer is.
for (const theme of themes) {
  // mutation check: removed the onKeyDown edge handler in AssistantDrawer -> this test failed (Tab looped inside)
  // mutation check: removed the open-drawer padding in styles.css -> this test failed (Ask Credalent under the drawer)
  test(`the assistant drawer at 1280 px lets Tab leave for the page and come back (${theme})`, async ({
    page,
    context,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await context.addCookies([{ name: 'theme', value: theme, url: 'http://localhost:3200' }]);
    await page.goto('/app');
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    const ask = page.getByRole('button', { name: 'Ask Credalent' });
    await ask.click();
    const drawer = page.getByRole('dialog', { name: 'Credalent assistant' });
    const question = drawer.getByRole('textbox', { name: 'Ask about what is on this page' });
    await expect(question).toBeFocused();
    await expectAccessible(page);
    await page.keyboard.press('Tab');
    await expect(drawer.getByRole('button', { name: 'Ask', exact: true })).toBeFocused();
    // Tab off the drawer's last control: out to the opener on the page, in view, and the drawer stays open.
    await page.keyboard.press('Tab');
    await expect(ask).toBeFocused();
    expect(await focusInView(page)).toBe('visible');
    await expect(drawer).toBeVisible();
    // Tab carries on through the page, not back into the drawer.
    await page.keyboard.press('Tab');
    expect(await focusInDrawer(page)).toBe(false);
    expect(await focusInView(page)).toBe('visible');
    // The documented way back: Shift+Tab to "Ask Credalent" and press it.
    await page.keyboard.press('Shift+Tab');
    await expect(ask).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(question).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();
    await expect(ask).toBeFocused();
  });
}
