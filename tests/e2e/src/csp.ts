import { expect, test as base, type Page } from '@playwright/test';

// AIV-P1-092: Chromium logs a blocked script, style, connection or form as a console error naming the policy. The
// match is on Chromium's wording: these projects run only Chromium (devices['Desktop Chrome']).
export function watchCsp(page: Page) {
  const violations: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' && message.text().includes('Content Security Policy')) {
      violations.push(message.text());
    }
  });
  return violations;
}

/** Playwright's `test` that fails any test whose page logs a content security policy violation. */
export const test = base.extend({
  page: async ({ page }, use) => {
    const violations = watchCsp(page);
    await use(page);
    expect(violations).toEqual([]);
  },
});

export { expect };
