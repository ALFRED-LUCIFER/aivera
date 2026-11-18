import { expect, test } from '@playwright/test';
import { signIn } from './auth.ts';
import { expectNoAxeViolations, themes } from './gallery.ts';

// AIV-P0-009 J0 smoke: recruiter sign-in against a mocked OIDC provider standing in for the External ID tenant.
// "/desk" in the ticket is My desk at /app; "/jobs" is /app/jobs.

const desk = async (page: import('@playwright/test').Page) => {
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByRole('heading', { level: 1, name: 'My desk' })).toBeVisible();
};

// SAFETY: mutation check: pointed the proxy matcher at /nowhere instead of /app/:path* -> this test failed
test('Scenario: Protected pages need a session', async ({ page }) => {
  await page.goto('/app/jobs');
  await expect(page).toHaveURL(/\/sign-in\?/);
  expect(new URL(page.url()).searchParams.get('next')).toBe('/app/jobs');
});

test('signing in from a protected page returns to it', async ({ page }) => {
  await page.goto('/app/jobs');
  await signIn(page);
  await expect(page).toHaveURL(/\/app\/jobs$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Jobs' })).toBeVisible();
});

test('Scenario: Email and password sign-in lands on My desk', async ({ page }) => {
  await signIn(page, { email: 'alex@example.com', button: 'Sign in' });
  await desk(page);
});

// Email one-time code and Microsoft accounts are not offered: the recruiter user flow has email with password and
// Google only (owner decision on #241; docs/runbooks/recruiter-sign-in.md).
test('Scenario: Social sign-in with "Continue with Google"', async ({ page }) => {
  await page.goto('/sign-in');
  await page.getByRole('button', { name: 'Continue with Google' }).click();
  // The tenant is asked to go straight to Google (domain_hint).
  await expect(page.getByText('Provider: google')).toBeVisible();
  await page.getByLabel('Email', { exact: true }).fill('nadia@example.com');
  await page.getByRole('button', { name: 'Continue' }).click();
  await desk(page);
});

test('Scenario: An unverified email never joins an existing account', async ({ page, context }) => {
  await signIn(page, { email: 'omar.agency@example.com' });
  await desk(page);
  await context.clearCookies();
  await signIn(page, { email: 'omar.agency@example.com', button: 'Continue with Google', verified: false });
  await expect(page).toHaveURL(/\/sign-in/);
  await expect(page.getByRole('alert').filter({ hasText: 'Verify your email to continue.' })).toBeVisible();
  await page.goto('/app');
  await expect(page).toHaveURL(/\/sign-in/);
});

test('Scenario: There is no company single sign-on button yet', async ({ page }) => {
  await page.goto('/sign-in');
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
  await expect(page.getByText('Continue with single sign-on')).toHaveCount(0);
  // Only what the user flow really offers.
  await expect(page.getByText('Email me a code')).toHaveCount(0);
  await expect(page.getByText('Continue with Microsoft')).toHaveCount(0);
});

test('Scenario: Open redirects are refused', async ({ page }) => {
  await signIn(page, { from: '/sign-in?next=https://evil.example' });
  await desk(page);
});

test('Scenario: The session lives only in a secure cookie', async ({ page, context }) => {
  await signIn(page);
  await desk(page);
  const session = (await context.cookies()).find((c) => c.name === '__Host-aivera-session');
  expect(session).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Lax', path: '/' });
  const stored = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));
  expect(stored).not.toMatch(/alex|@example\.com|eyJ|token/i);
});

test('the sign-in form works from the keyboard', async ({ page }) => {
  await page.goto('/sign-in');
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('Email')).toBeFocused();
  await page.keyboard.type('alex@example.com');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Mock tenant sign-in' })).toBeVisible();
  await expect(page.getByLabel('Email', { exact: true })).toHaveValue('alex@example.com');
});

for (const theme of themes) {
  test(`axe passes on the sign-in page (${theme})`, async ({ page, context }) => {
    await context.addCookies([{ name: 'theme', value: theme, url: 'http://localhost:3200' }]);
    await page.goto('/sign-in?error=unverified_email');
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await expect(page.getByRole('alert').filter({ hasText: 'Verify your email to continue.' })).toBeVisible();
    await expectNoAxeViolations(page);
  });
}
