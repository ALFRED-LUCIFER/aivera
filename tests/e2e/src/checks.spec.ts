import { expect, test } from '@playwright/test';
import { css, expectNoAxeViolations, openGallery, themes } from './gallery.ts';

// Browser-only checks queued on #57 by the reviews of AIV-P0-022 (#207), AIV-P0-023 and AIV-P0-024 (#206).

// mutation check: made Confirm `disabled` while pending in PreviewConfirm.tsx -> this test failed (focus on <body>)
test('focus stays inside the preview card after a failed confirm', async ({ page }) => {
  await openGallery(page, 'light');
  await page.getByRole('button', { name: 'Preview a move (confirm fails)' }).click();
  const card = page.getByRole('dialog', { name: 'Preview: move Sara Al Qahtani to Round 2' });
  await card.getByRole('button', { name: 'Confirm move' }).click();
  await expect(card.getByRole('alert')).toBeVisible();
  // Real focus fix-up: had Confirm been disabled while pending, the browser would have moved focus to <body>.
  await expect(card.getByRole('button', { name: 'Confirm move' })).toBeFocused();
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"]')))).toBe(true);
  }
});

// mutation check: removed the forced-colours outline from score-track in styles.css -> this test failed
test('the score track stays visible under forced colours', async ({ page }) => {
  await page.emulateMedia({ forcedColors: 'active' });
  await openGallery(page, 'light');
  const track = page.locator('#score .score-track').first();
  // Forced colours drop the track's background and inset ring; the outline keeps the empty part up to 100 visible.
  await expect.poll(() => css(track, 'outline-style')).toBe('solid');
  await expect.poll(() => css(track, 'outline-width')).toBe('1px');
  await expect(page.locator('section#score')).toHaveScreenshot('score-forced-colours.png');
});

for (const theme of themes) {
  // mutation check: removed `underline` from EvidenceHighlight's mark -> both themes failed
  test(`evidence highlight keeps its ink underline (${theme})`, async ({ page }) => {
    await openGallery(page, theme);
    const mark = page.locator('#evidence mark').first();
    // WCAG 1.4.1: cited text is identifiable without colour, by an underline in the mark's own ink.
    await expect.poll(() => css(mark, 'text-decoration-line')).toBe('underline');
    await expect.poll(() => css(mark, 'text-decoration-thickness')).toBe('2px');
    expect(await css(mark, 'text-decoration-color')).toBe(await css(mark, 'color'));
  });
}

// Depends on Radix looping focus inside the drawer; AIV-P0-920 (#224) makes it modal at this width instead.
// mutation check: set the dialog focus scope's `loop: true` to false in @radix-ui/react-dialog -> this test failed
test('the assistant drawer at 390 px does not hide focused page content (WCAG 2.4.11)', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openGallery(page, 'light');
  await page.getByRole('button', { name: 'Ask Aivera' }).click();
  await expect(page.getByRole('dialog', { name: 'Aivera assistant' })).toBeVisible();
  await expectNoAxeViolations(page);
  // The drawer covers the page at this width, so every Tab stop, both ways round, must be in view: Radix loops focus
  // inside the drawer, which never lets keyboard focus land on page content underneath it.
  const focusInView = () =>
    page.evaluate(() => {
      const focused = document.activeElement;
      if (!focused || focused === document.body) return 'nothing focused';
      const box = focused.getBoundingClientRect();
      const top = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      return top && focused.contains(top) ? 'visible' : `hidden: ${focused.outerHTML.slice(0, 80)}`;
    });
  for (const key of ['Tab', 'Shift+Tab']) {
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press(key);
      expect(await focusInView()).toBe('visible');
    }
  }
});

// mutation check: removed `motion-reduce:transition-none` from AssistantDrawer -> this test failed
test('reduced motion turns off the drawer and dialog transitions', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openGallery(page, 'light');
  await page.getByRole('button', { name: 'Ask Aivera' }).click();
  await expect
    .poll(() => css(page.getByRole('dialog', { name: 'Aivera assistant' }), 'transition-property'))
    .toBe('none');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Open dialog' }).click();
  await expect.poll(() => css(page.getByRole('dialog', { name: 'Rename job' }), 'transition-property')).toBe('none');
});
