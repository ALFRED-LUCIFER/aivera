import { expect, test } from '@playwright/test';

// AIV-P1-092. `next dev` serves it, so HSTS (production only) is checked in next.config.test.ts.
for (const [path, header, value] of [
  ['/', 'content-security-policy', "frame-ancestors 'none'"],
  ['/sign-in', 'x-content-type-options', 'nosniff'],
  ['/app', 'referrer-policy', 'strict-origin-when-cross-origin'],
  ['/candidates', 'x-frame-options', 'DENY'],
] as const) {
  test(`Scenario: ${path} carries ${header}`, async ({ request }) => {
    const response = await request.get(path, { maxRedirects: 0 });
    expect(response.headers()[header]).toContain(value);
  });
}

test('Scenario: sign-in runs under the policy with no CSP violation', async ({ page }) => {
  const violations: string[] = [];
  page.on('console', (message) => {
    if (message.text().includes('Content Security Policy')) violations.push(message.text());
  });
  await page.goto('/sign-in');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Mock tenant sign-in' })).toBeVisible();
  expect(violations).toEqual([]);
});
