import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { signIn } from './auth.ts';
import { expectNoAxeViolations, themes } from './gallery.ts';

// AIV-P2-035 (ADR-012): the operator console at /ops. playwright.config.ts sets PLATFORM_OPERATOR_EMAILS to
// "pia.platform@example.com,Theo.Platform@example.com" (the Background); the fail-closed app is ops.unconfigured.spec.ts.
// Synthetic people only (docs/00-product/personas.md).

const PIA = 'pia.platform@example.com';
const OPENED_COOKIE = '__Host-aivera-ops-opened';
const noAccess = 'You do not have access to this. Ask your workspace admin.';
const cookie = async (context: BrowserContext, name: string) => (await context.cookies()).find((c) => c.name === name);

async function expectConsole(page: Page) {
  await expect(page.getByRole('heading', { level: 1, name: 'Aivera operations' })).toBeVisible();
  await expect(page.getByText('Signed in as an Aivera operator.')).toBeVisible();
  await expect(page).toHaveTitle('Aivera operations');
}

async function expectRefused(page: Page) {
  const response = await page.goto('/ops');
  expect(response?.status()).toBe(403);
  await expect(page.getByText(noAccess)).toBeVisible();
  // No console data in the response: not the heading, the sections, the title or the operator line.
  const html = (await response?.text()) ?? '';
  expect(html).not.toMatch(/Aivera operations|Signed in as an Aivera operator|Coming soon/);
}

test('Scenario: An operator opens the console', async ({ page, context }) => {
  await signIn(page, { email: PIA });
  const response = await page.goto('/ops');
  expect(response?.status()).toBe(200);
  await expectConsole(page);
  await expect(page.getByRole('navigation', { name: 'Operations' })).toContainText('Workspaces');
  // The server action recorded "ops.console_opened" and marked this session with her opaque user id (no email).
  await expect.poll(async () => (await cookie(context, OPENED_COOKIE))?.value).toMatch(/^[0-9a-f-]{36}$/);
  expect(await cookie(context, OPENED_COOKIE)).toMatchObject({ httpOnly: true, secure: true, path: '/' });
});

test('Scenario: Email matching ignores case', async ({ page }) => {
  // Listed as "Theo.Platform@example.com"; he signs in as "theo.platform@example.com".
  await signIn(page, { email: 'theo.platform@example.com' });
  await page.goto('/ops');
  await expectConsole(page);
});

// SAFETY: mutation check: removed `await platformOperator()` from the /ops layout and page -> this test failed (200)
for (const email of ['alex@example.com', 'huda@example.com', 'sara@example.com']) {
  test(`Scenario Outline: Everyone else is refused on the server (${email})`, async ({ page }) => {
    // Alex is admin of "Demo Hiring Co", Huda a hiring owner, Sara a candidate who also signs in on the recruiter side.
    await signIn(page, { email });
    await expectRefused(page);
  });
}

test('Scenario Outline: Everyone else is refused: a candidate session alone never opens the console', async ({
  page,
}) => {
  await page.goto('/candidates/sign-in');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByLabel('Email', { exact: true }).fill('sara@example.com');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page).toHaveURL(/\/candidates\/me$/);
  await page.goto('/ops');
  await expect(page).toHaveURL(/\/sign-in\?next=%2Fops$/);
  await expect(page.getByText('Aivera operations')).toHaveCount(0);
});

test('Scenario: Not signed in', async ({ page }) => {
  await page.goto('/ops');
  await expect(page).toHaveURL(/\/sign-in\?next=%2Fops$/);
  await signIn(page, { email: PIA });
  await expect(page).toHaveURL(/\/ops$/);
  await expectConsole(page);
});

test('Scenario: An unverified email never makes an operator', async ({ page }) => {
  // A method the identity module has not seen, with email_verified false: no user and no session (ADR-009 point 4).
  await signIn(page, { email: PIA, button: 'Continue with Google', verified: false });
  await expect(page.getByRole('alert').filter({ hasText: 'Verify your email to continue.' })).toBeVisible();
  await page.goto('/ops');
  await expect(page).toHaveURL(/\/sign-in\?next=%2Fops$/);
});

test('Scenario: Being an operator grants nothing inside workspaces', async ({ page }) => {
  await signIn(page, { email: PIA });
  await page.goto('/app');
  await expect(page.getByRole('heading', { level: 1, name: 'You are not in a workspace yet' })).toBeVisible();
  // No recruiter page opens for her: the recruiter layout shows the no-workspace message instead. Recruiter server
  // actions refuse a user with no workspace in inActiveWorkspace (addJob.test.ts, workspace.test.ts).
  await page.goto('/app/jobs');
  await expect(page.getByRole('heading', { level: 1, name: 'You are not in a workspace yet' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: 'Jobs' })).toHaveCount(0);
});

test('Scenario: No operator email reaches URLs', async ({ page }) => {
  const urls: string[] = [];
  page.on('request', (request) => urls.push(request.url()));
  await page.goto('/ops');
  await signIn(page, { email: PIA });
  await expectConsole(page);
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/sign-in/);
  await signIn(page, { email: 'alex@example.com' });
  await expectRefused(page);
  expect(urls.length).toBeGreaterThan(0);
  expect(urls.filter((url) => /pia\.platform|example\.com/i.test(decodeURIComponent(url)))).toEqual([]);
});

test('the keyboard path: skip link to the page, then the console link, Workspaces, Catalogue and Sign out', async ({
  page,
}) => {
  await signIn(page, { email: PIA });
  await page.goto('/ops');
  await expectConsole(page);
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('main#content')).toBeFocused();
  await page.goto('/ops');
  await expectConsole(page);
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Aivera operations' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Workspaces' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Catalogue' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/sign-in/);
  // Signing out also ended the console's once-per-session marker.
  expect(await cookie(page.context(), OPENED_COOKIE)).toBeUndefined();
});

for (const theme of themes) {
  test(`axe passes on the console and its 403 page (${theme})`, async ({ page, context, baseURL }) => {
    await context.addCookies([{ name: 'theme', value: theme, url: baseURL ?? '' }]);
    await signIn(page, { email: PIA });
    await page.goto('/ops');
    await expectConsole(page);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await expectNoAxeViolations(page);
    await context.clearCookies({ name: '__Host-aivera-session' });
    await signIn(page, { email: 'alex@example.com' });
    await expectRefused(page);
    await expectNoAxeViolations(page);
  });
}
