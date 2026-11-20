import { expect, test } from '@playwright/test';
import { css, expectNoAxeViolations, openGallery, themes } from './gallery.ts';

const sections = [
  'colours',
  'typography',
  'buttons',
  'controls',
  'overlays',
  'status',
  'basis',
  'stat',
  'provenance',
  'strength',
  'level',
  'score',
  'need',
  'evidence',
  'competency',
  'table',
  'preview',
  'assistant',
];

test('Scenario: The colour table matches the tokens', async ({ page }) => {
  await openGallery(page, 'light');
  const expected = {
    'Light theme': { bg: '#F6F4F1', surface: '#FFFFFF', text: '#1B1720', hl: '#FFE873', focus: '#1B1720' },
    'Dark theme': { bg: '#141118', surface: '#1D1922', text: '#F4F1F6', hl: '#4D4208', focus: '#FFE873' },
  };
  for (const [name, rows] of Object.entries(expected)) {
    const table = page.getByRole('table', { name });
    for (const [token, hex] of Object.entries(rows)) {
      await expect(table.locator(`tr[data-token="${token}"] td`).first()).toHaveText(hex);
    }
  }
});

for (const theme of themes) {
  test.describe(`${theme} theme`, () => {
    test.beforeEach(({ page }) => openGallery(page, theme));

    test('Scenario: Every component appears', async ({ page }) => {
      for (const id of sections) await expect(page.locator(`section#${id}`)).toBeVisible();
      if (theme === 'dark') {
        await expect.poll(() => css(page.locator('body'), 'background-color')).toBe('rgb(20, 17, 24)'); // #141118
        await expect
          .poll(() => css(page.locator('#competency > div').first(), 'background-color'))
          .toBe(
            'rgb(29, 25, 34)', // #1D1922
          );
        await expect
          .poll(() => css(page.locator('#evidence mark').first(), 'background-color'))
          .toBe(
            'rgb(77, 66, 8)', // #4D4208
          );
      }
    });

    test('Scenario: axe finds no violations', async ({ page }) => {
      await expectNoAxeViolations(page);
    });

    // Scenario: A visual change fails until approved. Each section is its own baseline, so a diff names the component.
    for (const id of sections) {
      test(`snapshot: ${id}`, async ({ page }) => {
        await expect(page.locator(`section#${id}`)).toHaveScreenshot(`${id}-${theme}.png`);
      });
    }

    test('open overlays: dialog, toast, drawer, previews', async ({ page }) => {
      await page.getByRole('button', { name: 'Open dialog' }).click();
      const dialog = page.getByRole('dialog', { name: 'Rename job' });
      await expect(dialog).toBeVisible();
      await expectNoAxeViolations(page);
      await expect(dialog).toHaveScreenshot(`dialog-${theme}.png`);
      await page.keyboard.press('Escape');

      await page.getByRole('button', { name: 'Show toast' }).click();
      const toast = page.getByRole('status').filter({ hasText: 'Rubric saved' });
      await expect(toast).toBeVisible();
      await expectNoAxeViolations(page);
      await page.getByRole('button', { name: 'Close' }).click();

      await page.getByRole('button', { name: 'Ask Credalent' }).click();
      const drawer = page.getByRole('dialog', { name: 'Credalent assistant' });
      await expect(drawer.getByRole('button', { name: 'Which claims are still open?' })).toBeVisible();
      await expectNoAxeViolations(page);
      await expect(drawer).toHaveScreenshot(`assistant-open-${theme}.png`);
      await page.keyboard.press('Escape');

      await page.getByRole('button', { name: 'Request evidence' }).click();
      const bulk = page.getByRole('dialog', { name: 'Preview: request evidence from 2 candidates' });
      await bulk.getByRole('button', { name: 'Send 2 requests' }).click();
      await expect(bulk.getByRole('button', { name: 'Sending…' })).toHaveAttribute('aria-busy', 'true');
      await expectNoAxeViolations(page);
      await expect(bulk).toHaveScreenshot(`preview-pending-${theme}.png`);
    });

    test('preview card fails, banner confirms into the success message', async ({ page }) => {
      await page.getByRole('button', { name: 'Preview a move (confirm fails)' }).click();
      const card = page.getByRole('dialog', { name: 'Preview: move Sara Al Qahtani to Round 2' });
      await expect(card).toHaveScreenshot(`preview-open-${theme}.png`);
      await card.getByRole('button', { name: 'Confirm move' }).click();
      await expect(card.getByRole('alert')).toHaveText('That did not go through. Nothing was changed.');
      await expectNoAxeViolations(page);
      await expect(card).toHaveScreenshot(`preview-failed-${theme}.png`);
      await card.getByRole('button', { name: 'Cancel' }).click();

      const banner = page.getByRole('region', { name: 'Preview: request evidence from 2 candidates' });
      await expect(banner.getByRole('checkbox', { name: 'Send a reminder after three days' })).toBeChecked();
      await banner.getByRole('button', { name: 'Send 2 requests' }).click();
      await expect(page.locator('#preview output')).toHaveText(/2 evidence requests sent/);
      await expectNoAxeViolations(page);
      await expect(page.locator('section#preview')).toHaveScreenshot(`preview-sent-${theme}.png`);
    });
  });
}
