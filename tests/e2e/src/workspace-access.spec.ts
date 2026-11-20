import { expect, test } from '@playwright/test';
import { signIn } from './auth.ts';
import { expectAccessible, themes } from './gallery.ts';

// AIV-P0-010: the recruiter app runs in the signed-in user's active workspace (seed.ts sets up the cast).

const noAccess = 'You do not have access to this. Ask your workspace admin.';

// SAFETY: mutation check: made withWorkspace skip the membership status check -> this test failed (404 instead of 403)
test('Scenario: A removed member loses access immediately', async ({ page }) => {
  await signIn(page, { email: 'lina@example.com' });
  const response = await page.goto('/app/jobs');
  expect(response?.status()).toBe(403);
  await expect(page.getByText(noAccess)).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: 'Jobs' })).toHaveCount(0);
});

// SAFETY: mutation check: made the /app no-workspace redirect to /ops unconditional (dropped isPlatformOperator,
// AIV-P2-058) -> this test failed (Huda, not an operator, landed on /ops)
test('a signed-in user with no workspace yet is told so, not shown a 404', async ({ page }) => {
  await signIn(page, { email: 'huda@example.com' });
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByRole('heading', { level: 1, name: 'You are not in a workspace yet' })).toBeVisible();
  await expect(page.getByText('Ask your workspace admin to add you to their workspace.')).toBeVisible();
});

for (const theme of themes) {
  test(`axe passes on the no-access and no-workspace pages (${theme})`, async ({ page, context }) => {
    await context.addCookies([{ name: 'theme', value: theme, url: 'http://localhost:3200' }]);
    await signIn(page, { email: 'huda@example.com' });
    await expect(page.getByRole('heading', { level: 1, name: 'You are not in a workspace yet' })).toBeVisible();
    await expectAccessible(page);
    await context.clearCookies({ name: '__Host-credalent-session' });
    await signIn(page, { email: 'lina@example.com' });
    await expect(page.getByText(noAccess)).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await expectAccessible(page);
  });
}
