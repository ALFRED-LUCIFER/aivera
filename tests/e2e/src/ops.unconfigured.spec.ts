import { expect, test } from '@playwright/test';
import { signIn } from './auth.ts';

// AIV-P2-035 (ADR-012), run by the "unconfigured" project: an app with no PLATFORM_OPERATOR_EMAILS (playwright.config.ts).
// The empty and malformed lists are covered by apps/web/src/server/env.test.ts and operator.test.ts.

// SAFETY: mutation check: made an empty operator list mean "allow" in isPlatformOperator -> this test failed (200)
test('Scenario Outline: The console fails closed without a valid operator list (unset)', async ({ page }) => {
  await signIn(page, { email: 'pia.platform@example.com' });
  // AIV-P2-058: no list, so no operator: sign-in lands on /app, never redirected to the console.
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByRole('heading', { level: 1, name: 'You are not in a workspace yet' })).toBeVisible();
  const response = await page.goto('/ops');
  expect(response?.status()).toBe(403);
  await expect(page.getByText('You do not have access to this. Ask your workspace admin.')).toBeVisible();
  await expect(page.getByText('Credalent operations')).toHaveCount(0);
});

test('Scenario Outline: The console fails closed: the recruiter app still works for Alex Recruiter', async ({
  page,
}) => {
  await signIn(page, { email: 'alex@example.com' });
  await expect(page).toHaveURL(/\/app$/);
  await page.goto('/app/jobs');
  await expect(page.getByRole('heading', { level: 1, name: 'Jobs' })).toBeVisible();
});
