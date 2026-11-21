import { expect, test } from '@playwright/test';
import { expectAccessible, focusInView, themes } from './gallery.ts';

// AIV-P1-095: the root 404 and error pages. Signed out: neither needs a session, and neither shows an id, path or
// error text.
for (const theme of themes) {
  test(`Scenario: An unknown address shows a proper 404 (${theme})`, async ({ page, context }) => {
    await context.addCookies([{ name: 'theme', value: theme, url: 'http://localhost:3200' }]);
    const response = await page.goto('/no-such-page');
    expect(response?.status()).toBe(404);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await expect(page.getByRole('heading', { level: 1, name: 'We could not find that page.' })).toBeVisible();
    await expect(page.getByRole('main')).not.toContainText('no-such-page');
    await expectAccessible(page);
    // Keyboard path: the link home is reached with Tab, in view, and Enter follows it.
    const home = page.getByRole('link', { name: 'Go to the home page' });
    await page.keyboard.press('Tab');
    await expect(home).toBeFocused();
    expect(await focusInView(page)).toBe('visible');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL('/');
  });

  // /dev/crash throws while rendering (development only, like the gallery).
  test(`Scenario: A crash shows a safe error page (${theme})`, async ({ page, context }) => {
    await context.addCookies([{ name: 'theme', value: theme, url: 'http://localhost:3200' }]);
    await page.goto('/dev/crash');
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await expect(page.getByRole('heading', { level: 1, name: 'Something went wrong. Try again.' })).toBeVisible();
    await expect(page.getByRole('main')).not.toContainText('crash-page-secret-text');
    await expectAccessible(page);
    // The dev-tools overlay takes the first Tab, so the button is focused directly and checked to be in view.
    await page.getByRole('button', { name: 'Try again' }).focus();
    expect(await focusInView(page)).toBe('visible');
    // Next 16 passes `retry`: it asks the server for the page again (which crashes again here).
    const again = page.waitForRequest((request) => request.url().includes('/dev/crash'));
    await page.keyboard.press('Enter');
    await again;
  });
}
