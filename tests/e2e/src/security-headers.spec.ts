import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
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

// SAFETY: mutation check: removed X-Frame-Options and frame-ancestors from securityHeaders -> this test failed (run on the production build)
test('Scenario: Framing is refused', async ({ page, baseURL }) => {
  const origin = new URL(baseURL ?? '').origin;
  // A real server on another port is another origin: a route-fulfilled or made-up host is refused by the browser's
  // local network checks before the policy is read, which would pass this test without it.
  const framer = createServer((_request, response) =>
    response.setHeader('content-type', 'text/html').end(`<iframe src="${origin}/sign-in"></iframe>`),
  );
  await new Promise<void>((resolve) => framer.listen(0, 'localhost', resolve));
  try {
    await page.goto(`http://localhost:${(framer.address() as AddressInfo).port}/`);
    // The page's load event waits for the iframe, so by now it either rendered the sign-in page or was refused.
    const urls = page.frames().map((f) => f.url());
    expect(urls).toHaveLength(2);
    expect(urls).not.toContainEqual(expect.stringContaining(origin));
  } finally {
    framer.close();
  }
});
