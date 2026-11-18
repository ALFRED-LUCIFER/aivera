import { AxeBuilder } from '@axe-core/playwright';
import { expect, type Locator, type Page } from '@playwright/test';

export const themes = ['light', 'dark'] as const;
export type Theme = (typeof themes)[number];

/** Opens the gallery and switches theme with its own toggle (retried until React has hydrated). */
export async function openGallery(page: Page, theme: Theme) {
  await page.goto('/dev/gallery');
  await expect(async () => {
    await page.getByText(theme === 'dark' ? 'Dark' : 'Light', { exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme, { timeout: 500 });
  }).toPass();
}

/** Zero axe violations on the whole page; the Next.js dev-tools badge is not ours. */
export async function expectNoAxeViolations(page: Page) {
  const { violations } = await new AxeBuilder({ page }).exclude('nextjs-portal').analyze();
  expect(violations.map(({ id, nodes }) => ({ id, targets: nodes.map((n) => n.target) }))).toEqual([]);
}

export const css = (locator: Locator, property: string) =>
  locator.evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), property);
