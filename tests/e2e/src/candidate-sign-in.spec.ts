import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { signIn } from './auth.ts';
import { expectAccessible, themes } from './gallery.ts';

// AIV-P0-011: candidate sign-in on a separate session, against the mocked tenant (tests/e2e/mock-oidc.ts) standing in
// for the candidate app registration and user flow. The unconfigured environment is candidate-sign-in.unconfigured.spec.ts.
// Sara has a candidate account (seed.ts), so her sign-in lands on My applications; sign-up is candidate-signup.spec.ts.

const RECRUITER_COOKIE = '__Host-credalent-session';
const CANDIDATE_COOKIE = '__Host-credalent-candidate';
const cookie = async (context: BrowserContext, name: string) => (await context.cookies()).find((c) => c.name === name);

/** Signs in through /candidates/sign-in and the mocked tenant. Synthetic people only. */
async function candidateSignIn(page: Page, email: string, button: 'Sign in' | 'Continue with Google' = 'Sign in') {
  if (!page.url().includes('/candidates/sign-in')) await page.goto('/candidates/sign-in');
  await page.getByRole('button', { name: button, exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Mock tenant sign-in' })).toBeVisible();
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByRole('button', { name: button === 'Sign in' ? 'Continue' : 'Sign in with Google' }).click();
}

for (const button of ['Sign in', 'Continue with Google'] as const) {
  test(`Scenario Outline: A candidate signs in with "${button}"`, async ({ page, context }) => {
    await page.goto('/candidates/me');
    await expect(page).toHaveURL(/\/candidates\/sign-in\?next=%2Fcandidates%2Fme$/);
    await candidateSignIn(page, 'sara@example.com', button);
    await expect(page).toHaveURL(/\/candidates\/me$/);
    await expect(page.getByRole('heading', { level: 1, name: 'My applications' })).toBeVisible();
    // The candidate layout reads the candidate session: the header offers My applications, not Create account.
    await expect(page.getByRole('banner').getByRole('link', { name: 'My applications' })).toBeVisible();
    expect(await cookie(context, CANDIDATE_COOKIE)).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
      path: '/',
    });
    expect(await cookie(context, RECRUITER_COOKIE)).toBeUndefined();
  });
}

test('Scenario: Only the two chosen ways in are offered, without the email in the URL', async ({ page }) => {
  await page.goto('/candidates/sign-in');
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
  await expect(page.getByText('Email me a code')).toHaveCount(0);
  await expect(page.getByText('Continue with Microsoft')).toHaveCount(0);
  await expect(page.getByLabel('Email')).toHaveCount(0);
  const toTenant = page.waitForRequest((request) => request.url().startsWith('http://localhost:3299/authorize'));
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  const authorize = new URL((await toTenant).url());
  expect(authorize.searchParams.get('client_id')).toBe('credalent-e2e-candidate');
  expect(authorize.searchParams.has('login_hint')).toBe(false);
  expect(authorize.href).not.toMatch(/@|%40/);
});

test('Scenario: The same person is one account on both sides', async ({ page, context }) => {
  await signIn(page, { email: 'nadia@example.com' });
  await expect(page).toHaveURL(/\/app$/);
  const recruiter = await cookie(context, RECRUITER_COOKIE);
  expect(recruiter).toBeDefined();
  await candidateSignIn(page, 'nadia@example.com');
  // She has no candidate account yet, so My applications sends her to finish sign-up (AIV-P3-007).
  await expect(page).toHaveURL(/\/candidates\/signup$/);
  expect(await cookie(context, CANDIDATE_COOKIE)).toBeDefined();
  // The candidate sign-in left the recruiter session exactly as it was (one identity user: tests/integration).
  expect((await cookie(context, RECRUITER_COOKIE))?.value).toBe(recruiter?.value);
});

// SAFETY: mutation check: share the cookie name (candidate cookie '__Host-credalent-session') -> this test failed
test('Scenario: Candidate and recruiter sessions are separate', async ({ page, context }) => {
  await candidateSignIn(page, 'sara@example.com');
  await expect(page).toHaveURL(/\/candidates\/me$/);
  await page.goto('/app');
  await expect(page).toHaveURL(/\/sign-in\?next=%2Fapp$/);
  expect(await cookie(context, RECRUITER_COOKIE)).toBeUndefined();
});

// SAFETY: mutation check: share the cookie name (candidate cookie '__Host-credalent-session') -> this test failed
test('Scenario: A recruiter session does not open candidate pages', async ({ page, context }) => {
  await signIn(page);
  await expect(page).toHaveURL(/\/app$/);
  await page.goto('/candidates/me');
  await expect(page).toHaveURL(/\/candidates\/sign-in\?next=%2Fcandidates%2Fme$/);
  expect(await cookie(context, CANDIDATE_COOKIE)).toBeUndefined();
  // The public candidate pages stay signed out for a recruiter.
  await expect(page.getByRole('banner').getByRole('link', { name: 'Create account' })).toBeVisible();
});

for (const theme of themes) {
  test(`axe passes on the candidate sign-in page (${theme})`, async ({ page, context, baseURL }) => {
    await context.addCookies([{ name: 'theme', value: theme, url: baseURL ?? '' }]);
    await page.goto('/candidates/sign-in?error=unverified_email');
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await expect(page.getByRole('alert').filter({ hasText: 'Verify your email to continue.' })).toBeVisible();
    await expectAccessible(page);
  });
}
