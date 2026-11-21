import { encode } from '@auth/core/jwt';
import { createDb } from '@credalent/db/client';
import { createIdentity } from '@credalent/identity/composition';
import { expect, test } from '@playwright/test';
import { databaseUrl, e2eAuthSecret } from '../playwright.config.ts';
import { watchCsp } from '../src/csp.ts';

// AIV-P1-092: the built app under the production policy.
const SESSION_COOKIE = '__Host-credalent-session';

for (const path of ['/', '/sign-in', '/candidates', '/candidates/jobs']) {
  test(`Scenario: ${path} loads with no CSP violation and no 'unsafe-eval'`, async ({ page }) => {
    const violations = watchCsp(page);
    const response = await page.goto(path);
    await page.waitForLoadState('networkidle');
    expect(response?.ok()).toBe(true);
    expect(response?.headers()['content-security-policy']).not.toContain('unsafe-eval');
    expect(violations).toEqual([]);
  });
}

test('Scenario: /candidates carries Strict-Transport-Security', async ({ request }) => {
  const response = await request.get('/candidates');
  expect(response.headers()['strict-transport-security']).toBe('max-age=31536000; includeSubDomains');
});

// The recruiter pages carry the largest client bundle (forms, zod), so they are the likeliest to trip the policy, e.g.
// zod's `new Function` probe. Sign-in through the mocked tenant cannot run here: the production `form-action` does not
// allow localhost. So the session cookie is minted with the test secret.
test('Scenario: recruiter pages run under the production policy with no CSP violation', async ({
  page,
  context,
  baseURL,
}) => {
  const db = createDb(databaseUrl, { max: 1 });
  let id: string;
  try {
    ({ id } = await createIdentity(db, { trustedIssuer: 'e2e-seed' }).upsertUserFromIdToken({
      issuer: 'e2e-seed',
      subject: 'alex@example.com',
      email: 'alex@example.com',
      emailVerified: true,
      displayName: 'Alex Recruiter',
    }));
  } finally {
    await db.$client.end();
  }
  const value = await encode({ token: { sub: id, remember: false }, secret: e2eAuthSecret, salt: SESSION_COOKIE });
  // Sent as a header: Chromium refuses to store a `__Host-` cookie set for http://localhost.
  await context.route(`${baseURL}/**`, (route) =>
    route.continue({ headers: { ...route.request().headers(), cookie: `${SESSION_COOKIE}=${value}` } }),
  );
  // A stand-in for Blob storage: the CV goes browser to storage with a signed URL (AIV-P0-016).
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
  await context.route('https://e2e.blob.core.windows.net/**', (route) =>
    route.fulfill(
      route.request().method() === 'OPTIONS'
        ? { status: 204, headers: { ...cors, 'access-control-allow-methods': 'PUT' } }
        : { status: 201, headers: cors },
    ),
  );
  const violations = watchCsp(page);
  for (const path of ['/app', '/app/jobs', '/app/jobs/new']) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  }
  // The same request putBlob.ts makes (apps/web/src/features/files/services/putBlob.ts), from a page under the policy.
  const status = await page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const request = new XMLHttpRequest();
        request.open('PUT', 'https://e2e.blob.core.windows.net/cv/e2e?sig=synthetic');
        request.setRequestHeader('x-ms-blob-type', 'BlockBlob');
        request.setRequestHeader('x-ms-blob-content-type', 'application/pdf');
        request.addEventListener('loadend', () => resolve(request.status));
        request.send(new Blob(['synthetic cv']));
      }),
  );
  expect(status).toBe(201);
  expect(violations).toEqual([]);
});
