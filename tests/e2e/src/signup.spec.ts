import { expect, test, type Page } from '@playwright/test';
import { signIn } from './auth.ts';
import { css, expectAccessible, themes } from './gallery.ts';

// AIV-P1-059 J1 step 0: from the home page through the (mocked) External ID sign-up to the no-workspace page.

const noWorkspace = async (page: Page) => {
  await expect(page.getByRole('heading', { level: 1, name: 'Create your workspace' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create your workspace' })).toBeVisible();
};

for (const theme of themes) {
  // SAFETY: mutation check: sent login_hint=nadia@example.com in SIGN_UP_PARAMS -> the URL check failed
  test(`Scenario: A visitor goes from the home page to the workspace form, with no personal data in a URL (${theme})`, async ({
    page,
    context,
    baseURL,
  }) => {
    await context.addCookies([{ name: 'theme', value: theme, url: baseURL ?? '' }]);
    const urls: string[] = [];
    page.on('request', (request) => {
      if (request.isNavigationRequest()) urls.push(decodeURIComponent(request.url()));
    });
    await page.goto('/');
    await page.getByRole('link', { name: 'Create your workspace' }).first().click();
    await expect(page.getByRole('heading', { name: 'Mock tenant sign-in' })).toBeVisible();
    await expect(page.getByText('Prompt: create', { exact: true })).toBeVisible();
    await page.getByLabel('Email', { exact: true }).fill(`nadia+signup-${theme}-${Date.now()}@example.com`);
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page).toHaveURL(/\/app$/);
    await noWorkspace(page);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await expectAccessible(page);
    expect(urls.length).toBeGreaterThan(2);
    for (const url of urls) expect(url).not.toMatch(/nadia|example\.com/i);
  });

  test(`"Create your workspace" and "Sign in" are links reached by keyboard with a focus ring (${theme})`, async ({
    page,
    context,
    baseURL,
  }) => {
    await context.addCookies([{ name: 'theme', value: theme, url: baseURL ?? '' }]);
    await page.goto('/');
    const header = page.getByRole('banner');
    for (const [name, href] of [
      ['Sign in', '/sign-in'],
      ['Create workspace', '/signup'],
    ] as const) {
      const link = header.getByRole('link', { name, exact: true });
      await expect(link).toHaveAttribute('href', href);
      for (let i = 0; i < 12 && !(await link.evaluate((el) => el === document.activeElement)); i++)
        await page.keyboard.press('Tab');
      await expect(link).toBeFocused();
      expect(await css(link, 'outline-style')).toBe('solid');
    }
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'Mock tenant sign-in' })).toBeVisible();
  });
}

// Scenario "Sign in on the home page opens Sign in" is website.spec.ts "Calls to action".

// Scenario "Sign-in not configured": signUpRedirect sends /signup here (signIn.test.ts); the e2e server always has a
// tenant, so this checks the page it lands on.
test('the not-set-up page shows its message, not an error page', async ({ page }) => {
  await page.goto('/sign-in?error=unavailable');
  await expect(page.getByRole('alert').filter({ hasText: 'Sign-in is not available here.' })).toBeVisible();
});

test('Scenario Outline: A signed-in user not in any workspace opening /signup sees the create form', async ({
  page,
}) => {
  await signIn(page, { email: `nadia+signed-in-${Date.now()}@example.com` });
  await noWorkspace(page);
  await page.goto('/signup');
  await expect(page).toHaveURL(/\/app$/);
  await noWorkspace(page);
});

// The shell does not render the workspace name; Alex's only workspace is "Demo Hiring Co" (seed.ts), and the synthetic
// workspace tag shows the desk opened inside it.
test('Scenario Outline: An admin of "Demo Hiring Co" opening /signup sees My desk', async ({ page }) => {
  await signIn(page);
  await page.goto('/signup');
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByRole('heading', { level: 1, name: 'My desk' })).toBeVisible();
  await expect(page.getByText('Synthetic demo data', { exact: true })).toBeVisible();
});
