import { expect, test } from '@playwright/test';

// AIV-P0-928, run by the "unconfigured" project: an app with recruiter sign-in but no Google settings (playwright.config.ts).

// SAFETY: mutation check: rendered the Google button whatever the settings -> this test failed
// SAFETY: mutation check: sent method "google" to the tenant when Google is not configured -> this test failed
test('Scenario: The Google button appears only when Google is configured (unset)', async ({ page }) => {
  await page.goto('/sign-in');
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toHaveCount(0);
  // A hand-made post of method "google" (no button exists to click) is refused, not sent to the tenant.
  await page.locator('form').evaluate((form) => {
    const button = Object.assign(document.createElement('button'), { type: 'submit', name: 'method', value: 'google' });
    button.textContent = 'Posted google';
    form.append(button);
  });
  await page.getByRole('button', { name: 'Posted google' }).click();
  await expect(page).toHaveURL(/\/sign-in\?error=unavailable$/);
});
