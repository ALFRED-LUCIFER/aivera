import { expect, test } from '@playwright/test';
import { watchCsp } from './csp.ts';

// AIV-P1-092. `next dev` serves this project, so HSTS and the production policy are checked by tests/e2e/production.
// The add-job and add-applicants specs use the `test` of ./csp.ts, so a violation fails those journeys; no CV is
// stored there (no Blob storage in this harness, see add-applicants.spec.ts).
for (const [path, header, value] of [
  ['/', 'content-security-policy', "frame-ancestors 'none'"],
  ['/sign-in', 'x-content-type-options', 'nosniff'],
  ['/app', 'referrer-policy', 'strict-origin-when-cross-origin'],
  ['/candidates', 'permissions-policy', 'camera=()'],
  ['/candidates', 'x-frame-options', 'DENY'],
] as const) {
  test(`Scenario: ${path} carries ${header}`, async ({ request }) => {
    const response = await request.get(path, { maxRedirects: 0 });
    expect(response.headers()[header]).toContain(value);
  });
}

test('Scenario: the violation listener sees a blocked connection', async ({ page }) => {
  const violations = watchCsp(page);
  await page.goto('/sign-in');
  await page.evaluate(() => fetch('https://blocked.credalent.example').catch(() => undefined));
  await expect.poll(() => violations.length).toBeGreaterThan(0);
});

test('Scenario: Framing is refused', async ({ page, baseURL }) => {
  const origin = new URL(baseURL ?? '').origin;
  await page.route('http://framer.example/', (route) =>
    route.fulfill({ contentType: 'text/html', body: `<iframe src="${origin}/app"></iframe>` }),
  );
  await page.goto('http://framer.example/');
  const frame = page.locator('iframe').contentFrame();
  // A refused frame shows the browser's error page, never ours.
  await expect.poll(() => page.frames().map((f) => f.url())).not.toContainEqual(expect.stringContaining(origin));
  await expect(frame.locator('body')).not.toContainText('Credalent');
});
