import { expect, test } from '@playwright/test';

// AIV-P0-011, run by the "unconfigured" project against an app with recruiter sign-in but no candidate
// sign-in settings, as on Azure dev until the owner registers the candidate app (playwright.config.ts).

test('Scenario: Sign-in not set up in this environment', async ({ page }) => {
  await page.goto('/candidates/sign-in');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/candidates\/sign-in\?error=unavailable$/);
  await expect(
    page.getByRole('alert').filter({ hasText: 'Sign-in is not set up in this environment yet.' }),
  ).toBeVisible();
  await page.goto('/candidates/jobs');
  await expect(page).toHaveURL(/\/candidates\/jobs$/);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
});

// SAFETY: mutation check: let an unconfigured environment through to /candidates/me (proxy returned NextResponse.next()) -> this test failed
test('Scenario: Sign-in not set up in this environment: My applications fails closed', async ({ page }) => {
  await page.goto('/candidates/me/cv/some-job');
  await expect(page).toHaveURL(/\/candidates\/sign-in\?next=%2Fcandidates%2Fme%2Fcv%2Fsome-job$/);
  await page.goto('/candidates/me');
  await expect(page).toHaveURL(/\/candidates\/sign-in\?next=%2Fcandidates%2Fme$/);
});
