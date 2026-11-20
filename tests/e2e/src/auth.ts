import { expect, test as base, type Page } from '@playwright/test';

type SignInOptions = {
  email?: string;
  /** The sign-in page's button, e.g. "Continue with Google". */
  button?: string;
  /** Whether the mocked provider calls the email verified. */
  verified?: boolean;
  /** The sign-in page URL, e.g. one with `?next=`. */
  from?: string;
};

/** Signs in through /sign-in and the mocked tenant, or the mocked Google (tests/e2e/mock-oidc.ts). Synthetic people only. */
export async function signIn(page: Page, options: SignInOptions = {}) {
  const { email = 'alex@example.com', button = 'Sign in', verified = true, from = '/sign-in' } = options;
  // Stays on a sign-in page a redirect already opened, so its `next` is kept.
  if (options.from || !page.url().includes('/sign-in')) await page.goto(from);
  await page.getByRole('button', { name: button, exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Mock tenant sign-in' })).toBeVisible();
  await page.getByLabel('Email', { exact: true }).fill(email);
  if (!verified) await page.getByLabel('Email verified').uncheck();
  // The mocked Google plays the same page; its "Sign in with Google" marks the method.
  const tenantButton = button === 'Continue with Google' ? 'Sign in with Google' : 'Continue';
  await page.getByRole('button', { name: tenantButton }).click();
}

const signedIn =
  (options: SignInOptions) =>
  async ({ page, baseURL }: { page: Page; baseURL: string | undefined }, use: (page: Page) => Promise<void>) => {
    await signIn(page, options);
    // Back from the mocked tenant and past the sign-in page, so a test can act at once.
    await page.waitForURL((url) => url.origin === new URL(baseURL ?? '').origin && !url.pathname.includes('sign-in'));
    await use(page);
  };

/**
 * The synthetic cast's roles (seed.ts, personas.md) as pages signed in through the mocked tenant: AP runs workspace
 * "Demo", the Head of Engineering is its hiring owner for the Senior AI Engineer, Sara Al Qahtani has a candidate account.
 * Each signs in the test's own `page`, so a test takes one of them.
 */
export const test = base.extend<Record<'recruiter' | 'hiringOwner' | 'candidate' | 'anonymous', Page>>({
  recruiter: signedIn({ email: 'ap@example.com' }),
  hiringOwner: signedIn({ email: 'head.engineering@example.com' }),
  candidate: signedIn({ email: 'sara@example.com', from: '/candidates/sign-in' }),
  anonymous: ({ page }, use) => use(page),
});
