import { decode } from '@auth/core/jwt';
import { expect, test, type BrowserContext } from '@playwright/test';
import { e2eAuthSecret } from '../playwright.config.ts';
import { signIn } from './auth.ts';
import { expectNoAxeViolations, themes } from './gallery.ts';

// AIV-P0-009 J0 smoke and AIV-P1-002 J1 step: recruiter sign-in against a mocked OIDC provider standing in for the
// External ID tenant.
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

// Email one-time code and Microsoft accounts are not offered: email with password on the tenant and Google directly
// (owner decision on #241, AIV-P0-928; docs/runbooks/recruiter-sign-in.md).
// SAFETY: mutation check: sent "Continue with Google" to the tenant (signIn('entra')) in startSignIn -> this test failed
test('Scenario: On a shared computer Google always shows the account chooser', async ({ page }) => {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill('alex@example.com');
  const authorize = page.waitForRequest((request) => new URL(request.url()).pathname === '/authorize');
  await page.getByRole('button', { name: 'Continue with Google' }).click();
  const url = new URL((await authorize).url());
  // Straight to Google, never the tenant, asking which account every time, and with no login_hint.
  expect(url.origin).toBe('http://localhost:3298');
  expect(url.searchParams.get('prompt')).toBe('select_account');
  expect(url.searchParams.has('login_hint')).toBe(false);
  await expect(page.getByLabel('Email', { exact: true })).toHaveValue('');
});

const newAddress = (name: string) => `${name}.${Date.now()}${Math.floor(Math.random() * 1000)}@example.com`;
const noWorkspace = (page: import('@playwright/test').Page) =>
  expect(page.getByRole('heading', { level: 1, name: 'You are not in a workspace yet' })).toBeVisible();

test('Scenario: First-time Google sign-in creates the user, and a returning one is the same user', async ({
  page,
  context,
}) => {
  const email = newAddress('nadia.freelance');
  await signIn(page, { email, button: 'Continue with Google' });
  await noWorkspace(page);
  const first = await sessionToken(context);
  expect(first.sub).toBeTruthy();
  await context.clearCookies();
  await signIn(page, { email, button: 'Continue with Google' });
  await noWorkspace(page);
  expect((await sessionToken(context)).sub).toBe(first.sub);
});

// Google's issuer is not trusted without email_verified true (the mocked Google sends it), so this is the real path.
test('Scenario: The same verified email by email and password and by Google is one user', async ({ page, context }) => {
  const email = newAddress('mira.recruiter');
  await signIn(page, { email });
  await noWorkspace(page);
  const byPassword = await sessionToken(context);
  await context.clearCookies();
  await signIn(page, { email, button: 'Continue with Google' });
  await noWorkspace(page);
  expect((await sessionToken(context)).sub).toBe(byPassword.sub);
});

test('Scenario: A refused sign-in adds nothing (explicit email_verified false)', async ({ page, context }) => {
  await signIn(page, { email: 'omar.agency@example.com' });
  await desk(page);
  await context.clearCookies();
  await signIn(page, { email: 'omar.agency@example.com', button: 'Continue with Google', verified: false });
  await expect(page).toHaveURL(/\/sign-in/);
  await expect(page.getByRole('alert').filter({ hasText: 'Verify your email to continue.' })).toBeVisible();
  await page.goto('/app');
  await expect(page).toHaveURL(/\/sign-in/);
});

// The password is typed on the tenant's page, never in the app, so "Password" is the note under the email field.
test('Scenario: The page offers only the two ways in and the artboard copy', async ({ page }) => {
  await page.goto('/sign-in');
  // The SignIn artboard: logo home link, headline with "evidence" under the highlighter, the three promises, the lead.
  await expect(page.getByRole('link', { name: 'Aivera' })).toHaveAttribute('href', '/');
  await expect(page.getByText('Hire on evidence, not claims.')).toBeVisible();
  await expect(page.locator('mark', { hasText: 'evidence' })).toBeVisible();
  for (const point of [
    'Every score cites the work it rests on.',
    'Claims are labelled as claims.',
    'Nobody is rejected automatically.',
  ])
    await expect(page.getByRole('listitem').filter({ hasText: point })).toBeVisible();
  await expect(page.getByText('Welcome back. Pick up where your roles left off.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Create a workspace' })).toHaveAttribute('href', '/signup');
  await expect(page.getByRole('checkbox', { name: 'Keep me signed in' })).not.toBeChecked();
  await expect(page.getByRole('button', { name: 'Forgot password?' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  await expect(page.getByLabel('Email')).toBeVisible();
  await expect(page.getByText('You enter your password on the next page')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
  await expect(page.getByText('Continue with single sign-on')).toHaveCount(0);
  // Only what the user flow really offers.
  await expect(page.getByText('Email me a code')).toHaveCount(0);
  await expect(page.getByText('Continue with Microsoft')).toHaveCount(0);
});

// SAFETY: mutation check: replaced safeNext's final /app check with `!path.startsWith('//')` -> the /candidates/jobs
// row failed
for (const next of ['https://evil.example', '//evil.example', '/candidates/jobs']) {
  test(`Scenario Outline: Return-to refuses anything outside the recruiter app (${next})`, async ({ page }) => {
    await signIn(page, { from: `/sign-in?next=${encodeURIComponent(next)}` });
    await desk(page);
  });
}

// SAFETY: mutation check: removed the `method === 'reset'` transform in parseSignInForm -> this test failed
test("Scenario: Forgot password opens the tenant's reset without my email in the URL", async ({ page }) => {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill('nadia@example.com');
  const authorize = page.waitForRequest((request) => new URL(request.url()).pathname === '/authorize');
  await page.getByRole('button', { name: 'Forgot password?' }).click();
  const url = new URL((await authorize).url());
  expect(url.origin).toBe('http://localhost:3299');
  expect(url.searchParams.has('login_hint')).toBe(false);
  expect(decodeURIComponent(url.href)).not.toMatch(/nadia|@example\.com/);
  await expect(page.getByRole('heading', { name: 'Mock tenant sign-in' })).toBeVisible();
  await expect(page.getByLabel('Email', { exact: true })).toHaveValue('');
});

// The session token's own expiry, read with the e2e-only secret: the cookie lives 30 days either way.
async function sessionToken(context: BrowserContext) {
  const salt = '__Host-aivera-session';
  const token = (await context.cookies()).find((c) => c.name === salt)?.value ?? '';
  const payload = await decode({ token, secret: e2eAuthSecret, salt });
  return { sub: payload?.sub, exp: payload?.exp ?? 0, lifetime: (payload?.exp ?? 0) - (payload?.iat ?? 0) };
}

// SAFETY: mutation check: read the remember cookie under another name in auth.ts's NextAuth(request) -> the ticked row
// failed
for (const [choice, ticked, length] of [
  ['ticked', true, 30 * 24 * 60 * 60],
  ['unticked', false, 8 * 60 * 60],
] as const) {
  test(`Scenario Outline: Session length follows "Keep me signed in" (${choice})`, async ({ page, context }) => {
    await page.goto('/sign-in');
    await page.getByRole('checkbox', { name: 'Keep me signed in' }).setChecked(ticked);
    await signIn(page);
    await desk(page);
    const first = await sessionToken(context);
    expect(first.lifetime).toBe(length);
    // The next request re-issues the token: ticked keeps its end 30 days after sign-in, unticked restarts its 8 hours.
    await page.goto('/app/jobs');
    await expect(page.getByRole('heading', { level: 1, name: 'Jobs' })).toBeVisible();
    const reissued = await sessionToken(context);
    // Within a second: the encode clock may tick between computing the max age and stamping the token.
    if (ticked) expect(Math.abs(reissued.exp - first.exp)).toBeLessThanOrEqual(1);
    else expect(reissued.lifetime).toBe(length);
  });
}

// SAFETY: mutation check: removed the rememberCookie(false) line from the /signup route -> this test failed
test('a sign-up right after a kept sign-in and sign-out gets the 8-hour session', async ({ page, context }) => {
  await page.goto('/sign-in');
  await page.getByRole('checkbox', { name: 'Keep me signed in' }).check();
  await signIn(page);
  await desk(page);
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
  await page.goto('/signup');
  await page.getByLabel('Email', { exact: true }).fill(`nadia+kept-${Date.now()}@example.com`);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page).toHaveURL(/\/app$/);
  expect((await sessionToken(context)).lifetime).toBe(8 * 60 * 60);
});

test('Scenario: Sign out', async ({ page, context }) => {
  await signIn(page);
  await desk(page);
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible();
  expect((await context.cookies()).find((c) => c.name === '__Host-aivera-session')).toBeUndefined();
  await page.goto('/app');
  await expect(page).toHaveURL(/\/sign-in\?/);
  // The tenant's own session outlives ours: the next sign-in must make the tenant ask again (shared computer).
  // SAFETY: mutation check: dropped `prompt: 'login'` from authorizationParams -> this test failed
  const authorize = page.waitForRequest((request) => new URL(request.url()).pathname === '/authorize');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  expect(new URL((await authorize).url()).searchParams.get('prompt')).toBe('login');
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
  for (const control of [
    page.getByRole('link', { name: 'Aivera' }),
    page.getByLabel('Email'),
    page.getByRole('checkbox', { name: 'Keep me signed in' }),
    page.getByRole('button', { name: 'Forgot password?' }),
    page.getByRole('button', { name: 'Sign in', exact: true }),
    page.getByRole('button', { name: 'Continue with Google' }),
    page.getByRole('link', { name: 'Create a workspace' }),
  ]) {
    await page.keyboard.press('Tab');
    await expect(control).toBeFocused();
  }
  await page.getByRole('checkbox', { name: 'Keep me signed in' }).focus();
  await page.keyboard.press('Space');
  await expect(page.getByRole('checkbox', { name: 'Keep me signed in' })).toBeChecked();
  await page.getByLabel('Email').focus();
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

// AIV-P1-068: the ink panel stacks above the form at phone width, with no sideways scroll.
test('the sign-in page stacks at phone width with no horizontal scroll', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto('/sign-in');
  const panel = await page.getByRole('complementary').boundingBox();
  const form = await page.getByRole('main').boundingBox();
  expect(panel && form && panel.y + panel.height <= form.y).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
