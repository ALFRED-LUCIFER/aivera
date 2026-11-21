import { AxeBuilder } from '@axe-core/playwright';
import { expect, type Locator, type Page } from '@playwright/test';

export const themes = ['light', 'dark'] as const;
type Theme = (typeof themes)[number];

/** Opens the gallery and switches theme with its own toggle (retried until React has hydrated). */
export async function openGallery(page: Page, theme: Theme) {
  await page.goto('/dev/gallery');
  await expect(async () => {
    await page.getByText(theme === 'dark' ? 'Dark' : 'Light', { exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme, { timeout: 500 });
  }).toPass();
}

/**
 * Zero axe violations on the whole page, of any impact (stricter than serious and critical only, AIV-P0-032); a failure
 * names each rule, its impact and the selectors. The Next.js dev-tools badge is not ours.
 */
export async function expectAccessible(page: Page) {
  // Next streams an async generateMetadata title in after the content, so after router.refresh() the page can be
  // briefly untitled; audit the settled page. A page that never gets a title still fails here.
  await expect(page).toHaveTitle(/\S/);
  const { violations } = await new AxeBuilder({ page }).exclude('nextjs-portal').analyze();
  expect(violations.map(({ id, impact, nodes }) => ({ id, impact, targets: nodes.map((n) => n.target) }))).toEqual([]);
}

export const css = (locator: Locator, property: string) =>
  locator.evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), property);

/** Whether the focused element is the topmost thing at its centre: in view, not under the drawer (WCAG 2.4.11). */
export const focusInView = (page: Page) =>
  page.evaluate(() => {
    const focused = document.activeElement;
    if (!focused || focused === document.body) return 'nothing focused';
    const box = focused.getBoundingClientRect();
    const top = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    return top && focused.contains(top) ? 'visible' : `hidden: ${focused.outerHTML.slice(0, 80)}`;
  });
/** Whether focus is inside a dialog (the assistant drawer). */
export const focusInDrawer = (page: Page) =>
  page.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"]')));
