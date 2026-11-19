import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { signIn } from './auth.ts';
import { expectNoAxeViolations, themes } from './gallery.ts';

// AIV-P3-007, journey J5 step 5: candidate sign-up and sign-in against the mocked tenant (tests/e2e/mock-oidc.ts),
// which plays the tenant's hosted sign-up page. Synthetic people only; each sign-up uses a new address, so a reused
// local database starts every run with no candidate account for it.

const RECRUITER_COOKIE = '__Host-aivera-session';
const CANDIDATE_COOKIE = '__Host-aivera-candidate';
const SHARING =
  'Your CV and work are shared with a recruiter only when you apply to their job or answer their request.';
const cookie = async (context: BrowserContext, name: string) => (await context.cookies()).find((c) => c.name === name);
const newAddress = (name: string) => `${name}.${Date.now()}${Math.floor(Math.random() * 1000)}@example.com`;

/** Chooses a button on the signed-out sign-up or sign-in page, then signs in on the mocked tenant's page. */
async function throughTenant(page: Page, email: string, button: string) {
  await page.getByRole('button', { name: button, exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Mock tenant sign-in' })).toBeVisible();
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page
    .getByRole('button', { name: button === 'Continue with Google' ? 'Sign in with Google' : 'Continue' })
    .click();
}

const fullName = (page: Page) => page.getByLabel('Full name');
const workType = (page: Page) => page.getByLabel('What kind of work do you do?');

test('Scenario: Creating a free account after the tenant sign-up, then signing out and back in', async ({
  page,
  context,
}) => {
  const email = newAddress('layla.haddad');
  await page.goto('/candidates/signup');
  await expect(page.getByRole('heading', { level: 1, name: 'Create your free account' })).toBeVisible();
  await throughTenant(page, email, 'Create free account');

  // Back on sign-up, signed in: only what the tenant does not know, prefilled from its display name.
  await expect(page).toHaveURL(/\/candidates\/signup$/);
  await expect(fullName(page)).toHaveValue(email.split('@')[0] ?? '');
  await expect(workType(page)).toBeVisible();
  await expect(page.getByRole('main').getByRole('textbox')).toHaveCount(1);
  await expect(page.locator('input[type="password"], input[type="email"]')).toHaveCount(0);
  // The Plus button waits for payment (AIV-P4-004) behind its flag.
  await expect(page.getByRole('button', { name: /start Plus/ })).toHaveCount(0);

  // Scenario: Full name is required.
  await fullName(page).fill('');
  await workType(page).selectOption({ label: 'AI and LLM engineering' });
  await page.getByRole('button', { name: 'Create free account' }).click();
  await expect(page.getByText('Enter your full name.')).toBeVisible();
  await expect(fullName(page)).toHaveAttribute('aria-invalid', 'true');
  await expect(fullName(page)).toHaveAccessibleDescription('Enter your full name.');
  await expect(page).toHaveURL(/\/candidates\/signup$/);

  // The keyboard path: type the name, move through the work type to the button, and submit with Enter.
  await fullName(page).focus();
  await page.keyboard.type('Layla Haddad');
  await page.keyboard.press('Tab');
  await expect(workType(page)).toBeFocused();
  await workType(page).selectOption({ label: 'AI and LLM engineering' });
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Create free account' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/candidates\/me$/);
  await expect(page.getByRole('heading', { level: 1, name: 'My applications' })).toBeVisible();

  // Scenario: Someone who already has a candidate account.
  await page.goto('/candidates/signup');
  await expect(page).toHaveURL(/\/candidates\/me$/);

  // Candidate sign-out ends only the candidate session.
  await page.getByRole('banner').getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/candidates\/sign-in$/);
  expect(await cookie(context, CANDIDATE_COOKIE)).toBeUndefined();
  await page.goto('/candidates/me');
  await expect(page).toHaveURL(/\/candidates\/sign-in\?next=%2Fcandidates%2Fme$/);

  // Scenario: Signing in returns me where I was (the apply form; AIV-P3-008 sends a signed-out candidate here).
  // The apply form is a placeholder for any job address until AIV-P3-008; candidate-job.spec.ts links a real job to it.
  const apply = '/candidates/jobs/senior-ai-engineer/apply';
  await page.goto(`/candidates/sign-in?next=${encodeURIComponent(apply)}`);
  await throughTenant(page, email, 'Sign in');
  await expect(page).toHaveURL(new RegExp(`${apply}$`));
  await expect(page.getByRole('banner').getByRole('link', { name: 'My applications' })).toBeVisible();
});

test('Scenario: Signing up with Google', async ({ page }) => {
  await page.goto('/candidates/signup');
  await throughTenant(page, newAddress('arjun.mehta'), 'Continue with Google');
  await expect(page).toHaveURL(/\/candidates\/signup$/);
  await fullName(page).fill('Arjun Mehta');
  await workType(page).selectOption({ label: 'QA and test automation' });
  await page.getByRole('button', { name: 'Create free account' }).click();
  await expect(page).toHaveURL(/\/candidates\/me$/);
});

test('Scenario: Only the two ways in are offered, and sharing is explained before sign-up', async ({ page }) => {
  for (const path of ['/candidates/signup', '/candidates/sign-in']) {
    await page.goto(path);
    await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
    await expect(page.getByText('Email me a code')).toHaveCount(0);
    await expect(page.getByText('Continue with Microsoft')).toHaveCount(0);
    await expect(page.locator('input[type="password"]')).toHaveCount(0);
  }
  await page.getByRole('link', { name: 'Create free account' }).click();
  await expect(page).toHaveURL(/\/candidates\/signup$/);
  await expect(page.getByRole('main')).toContainText(SHARING);
  await expect(page.getByRole('main')).toContainText('Free, with no card needed.');
  await page.getByRole('link', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/candidates\/sign-in$/);
});

// SAFETY: mutation check: candidateSignOut also called server/auth signOut({ redirect: false }) -> this test failed
test("Scenario: A recruiter's email becomes the same login on the candidate site; signing out keeps the recruiter session", async ({
  page,
  context,
}) => {
  await signIn(page, { email: 'nadia@example.com' });
  await expect(page).toHaveURL(/\/app$/);
  const recruiter = await cookie(context, RECRUITER_COOKIE);
  await page.goto('/candidates/sign-in');
  await throughTenant(page, 'nadia@example.com', 'Sign in');
  // My applications sends her to finish sign-up: only her full name and kind of work.
  await expect(page).toHaveURL(/\/candidates\/signup$/);
  await expect(fullName(page)).toBeVisible();
  await expect(workType(page)).toBeVisible();
  // Nothing of her recruiter workspace appears on the candidate site.
  await expect(page.getByText('Nadia Freelance')).toHaveCount(0);
  await expect(page.getByText(/workspace/i)).toHaveCount(0);
  await page.getByRole('banner').getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/candidates\/sign-in$/);
  expect(await cookie(context, CANDIDATE_COOKIE)).toBeUndefined();
  expect((await cookie(context, RECRUITER_COOKIE))?.value).toBe(recruiter?.value);
  await page.goto('/app');
  await expect(page).toHaveURL(/\/app$/);
});

for (const theme of themes) {
  test(`axe passes on candidate sign-up, signed out and completing the profile (${theme})`, async ({
    page,
    context,
    baseURL,
  }) => {
    await context.addCookies([{ name: 'theme', value: theme, url: baseURL ?? '' }]);
    await page.goto('/candidates/signup');
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await expectNoAxeViolations(page);
    await throughTenant(page, newAddress('omar.farouk'), 'Create free account');
    await fullName(page).fill('');
    await page.getByRole('button', { name: 'Create free account' }).click();
    await expect(page.getByText('Enter your full name.')).toBeVisible();
    await expectNoAxeViolations(page);
  });
}
