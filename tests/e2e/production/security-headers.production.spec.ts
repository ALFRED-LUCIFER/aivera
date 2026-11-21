import { encode } from '@auth/core/jwt';
import { createDb } from '@credalent/db/client';
import { createIdentity } from '@credalent/identity/composition';
import { expect, test, type Page } from '@playwright/test';
import { databaseUrl, e2eAuthSecret } from '../playwright.production.config.ts';

// AIV-P1-092: the built app under the production policy.
const SESSION_COOKIE = '__Host-credalent-session';

function watchCsp(page: Page) {
  const violations: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' && message.text().includes('Content Security Policy')) {
      violations.push(message.text());
    }
  });
  return violations;
}

for (const path of ['/', '/sign-in', '/candidates', '/candidates/jobs']) {
  test(`Scenario: ${path} loads with no CSP violation and no 'unsafe-eval'`, async ({ page }) => {
    const violations = watchCsp(page);
    const response = await page.goto(path);
    await page.waitForLoadState('networkidle');
    expect(response?.headers()['content-security-policy']).not.toContain('unsafe-eval');
    expect(violations).toEqual([]);
  });
}

test('Scenario: /candidates carries Strict-Transport-Security', async ({ request }) => {
  const response = await request.get('/candidates');
  expect(response.headers()['strict-transport-security']).toBe('max-age=31536000; includeSubDomains');
});

// The recruiter pages are the ones whose client bundle builds zod schemas (zod probes `new Function`, which the
// production policy refuses unless instrumentation-client.ts sets `jitless`). Sign-in through the mocked tenant cannot
// run here: the production `form-action` does not allow localhost. So the session cookie is minted with the test secret.
test('Scenario: recruiter pages run under the production policy with no CSP violation', async ({
  page,
  context,
  baseURL,
}) => {
  const identity = createIdentity(createDb(databaseUrl, { max: 1 }), { trustedIssuer: 'e2e-seed' });
  const { id } = await identity.upsertUserFromIdToken({
    issuer: 'e2e-seed',
    subject: 'alex@example.com',
    email: 'alex@example.com',
    emailVerified: true,
    displayName: 'Alex Recruiter',
  });
  const value = await encode({ token: { sub: id, remember: false }, secret: e2eAuthSecret, salt: SESSION_COOKIE });
  await context.addCookies([{ name: SESSION_COOKIE, value, url: `${baseURL}/`, httpOnly: true, secure: true }]);
  const violations = watchCsp(page);
  for (const path of ['/app', '/app/jobs', '/app/jobs/new']) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  }
  expect(violations).toEqual([]);
});
