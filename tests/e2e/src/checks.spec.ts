import { expect, test } from '@playwright/test';
import { css, expectAccessible, focusInDrawer, focusInView, openGallery, themes } from './gallery.ts';

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

// AIV-P0-920: below lg the assistant drawer covers the page, so it is a modal there (1280 px: next).
for (const theme of themes) {
  // mutation check: hard-coded modal={false} in AssistantDrawer -> this test failed (page not hidden)
  test(`the assistant drawer at 390 px is modal while it covers the page (${theme})`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openGallery(page, theme);
    await page.getByRole('button', { name: 'Ask Credalent' }).click();
    const drawer = page.getByRole('dialog', { name: 'Credalent assistant' });
    await expect(drawer).toBeVisible();
    await expectAccessible(page);
    // Hidden from assistive tech: the page behind is aria-hidden, so its buttons leave the accessibility tree.
    await expect(page.getByRole('button', { name: 'Ask Credalent' })).toHaveCount(0);
    for (const key of ['Tab', 'Shift+Tab']) {
      for (let i = 0; i < 8; i++) {
        await page.keyboard.press(key);
        expect(await focusInDrawer(page)).toBe(true);
        expect(await focusInView(page)).toBe('visible');
      }
    }
    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();
    await expect(page.getByRole('button', { name: 'Ask Credalent' })).toBeFocused();
  });
}

// AIV-P0-920: from lg up the assistant drawer sits beside the page; "Ask Credalent" is top right, where the drawer is.
// The app shell no longer shows the assistant (AIV-P1-095), so the gallery guards the padding rule that still ships.
for (const theme of themes) {
  // mutation check: removed the onKeyDown edge handler in AssistantDrawer -> this test failed (Tab looped inside)
  // mutation check: removed the open-drawer padding in styles.css -> this test failed (Ask Credalent under the drawer)
  test(`the assistant drawer at 1280 px lets Tab leave for the page and come back (${theme})`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openGallery(page, theme);
    const ask = page.getByRole('button', { name: 'Ask Credalent' });
    await ask.click();
    const drawer = page.getByRole('dialog', { name: 'Credalent assistant' });
    const question = drawer.getByRole('textbox', { name: 'Ask about what is on this page' });
    await expect(question).toBeFocused();
    await expectAccessible(page);
    await page.keyboard.press('Tab');
    await expect(drawer.getByRole('button', { name: 'Ask', exact: true })).toBeFocused();
    // Tab off the drawer's last control: out to the opener on the page, in view, and the drawer stays open.
    await page.keyboard.press('Tab');
    await expect(ask).toBeFocused();
    expect(await focusInView(page)).toBe('visible');
    await expect(drawer).toBeVisible();
    // Tab carries on through the page, not back into the drawer.
    await page.keyboard.press('Tab');
    expect(await focusInDrawer(page)).toBe(false);
    expect(await focusInView(page)).toBe('visible');
    // The documented way back: Shift+Tab to "Ask Credalent" and press it.
    await page.keyboard.press('Shift+Tab');
    await expect(ask).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(question).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();
    await expect(ask).toBeFocused();
  });
}

// mutation check: removed `motion-reduce:transition-none` from AssistantDrawer -> this test failed
test('reduced motion turns off the drawer and dialog transitions', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openGallery(page, 'light');
  await page.getByRole('button', { name: 'Ask Credalent' }).click();
  await expect
    .poll(() => css(page.getByRole('dialog', { name: 'Credalent assistant' }), 'transition-property'))
    .toBe('none');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Open dialog' }).click();
  await expect.poll(() => css(page.getByRole('dialog', { name: 'Rename job' }), 'transition-property')).toBe('none');
});
