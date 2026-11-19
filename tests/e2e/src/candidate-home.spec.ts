import { expect, test } from '@playwright/test';
import { expectNoAxeViolations, themes } from './gallery.ts';

// AIV-P3-003, journey J5 step 2: the candidate home page over the jobs published by seed.ts, signed out.

test('the hero states the promise, and New this week lists the three newest jobs', async ({ page }) => {
  await page.goto('/candidates');
  await expect(page.getByRole('heading', { level: 1, name: 'Get hired for what you have done.' })).toBeVisible();
  await expect(page.getByText(/No tests to sit\./)).toBeVisible();
  await expect(page.getByText('Free to browse and apply. Always.')).toBeVisible();
  const fresh = page.getByRole('region', { name: 'New this week' });
  // seed.ts posts them 2, 6 and 9 days ago (the 9-day tie is either job); newest first.
  await expect(fresh.getByRole('heading', { level: 3 })).toHaveCount(3);
  await expect(fresh.getByRole('heading', { level: 3 }).nth(0)).toHaveText('Real Estate Sales Consultant');
  await expect(fresh.getByRole('heading', { level: 3 }).nth(1)).toHaveText('Senior AI Engineer');
  await expect(fresh).toContainText('A BNPL fintech · DIFC, Dubai');
  await expect(fresh.getByRole('link', { name: 'All jobs' })).toHaveAttribute('href', '/candidates/jobs');
  await expect(page.getByText('AED 49 a month')).toBeVisible();
  await expect(page.getByRole('contentinfo')).toContainText('Paying never changes how recruiters rank you.');
});

test('searching from the hero opens the jobs list filtered by the words', async ({ page }) => {
  await page.goto('/candidates');
  await page.getByRole('searchbox', { name: 'Job title or skill' }).fill('AI');
  await page.getByRole('button', { name: 'Find jobs' }).click();
  await expect(page).toHaveURL(/\/candidates\/jobs\?q=AI$/);
  await expect(page.getByRole('searchbox', { name: 'Job title or skill' })).toHaveValue('AI');
  await expect(page.getByRole('listitem').getByRole('heading', { level: 2 })).toContainText(['Senior AI Engineer']);
});

test('under reduced motion the hero is shown at once, highlighter included', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/candidates');
  const hero = page.getByRole('heading', { level: 1 });
  await expect(hero).toHaveCSS('opacity', '1');
  await expect(hero.locator('mark')).toHaveText('what you have done');
  await expect(hero.locator('mark')).toHaveCSS('background-color', 'rgb(255, 232, 115)'); // --hl #FFE873
});

for (const theme of themes) {
  test(`axe passes on the candidate home page (${theme})`, async ({ page, context }) => {
    await context.addCookies([{ name: 'theme', value: theme, url: 'http://localhost:3200' }]);
    // The hero rises in over about 1.4 s; reduced motion shows it settled, so axe checks it at full opacity.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/candidates');
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await expect(page.getByRole('region', { name: 'New this week' }).getByRole('heading', { level: 3 })).toHaveCount(3);
    await expectNoAxeViolations(page);
  });
}
