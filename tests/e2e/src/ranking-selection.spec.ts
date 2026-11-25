import { type Page } from '@playwright/test';
import { signIn } from './auth.ts';
import { expect, test } from './csp.ts';
import { expectAccessible, themes } from './gallery.ts';

// AIV-P1-036, the J2 step: select three candidates on the ranking and open the comparison, as AP, admin of "Demo"
// (seed.ts). Proven meanwhile in jsdom by Ranking.test.tsx.
// shortcut: not run while the `compare` flag is off (domain/selection.ts), since no checkbox shows; AIV-P1-047 (#111)
// turns the flag on with the comparison page and removes this line.
test.fixme(true, 'Selection is hidden until the comparison page exists (AIV-P1-047, #111).');

const AP = 'ap@example.com';

async function openRanking(page: Page) {
  await signIn(page, { email: AP });
  await page.goto('/app/jobs');
  await page.getByRole('link', { name: 'Senior AI Engineer' }).click();
  await expect(page).toHaveTitle('Senior AI Engineer: Evidence and ranking · Credalent');
  const table = page.getByRole('table', { name: 'Ranked candidates' });
  // The rows have streamed in, so focus stays where it is put.
  await expect(table.getByRole('checkbox', { name: /^Select / })).toHaveCount(8);
  return table;
}
const bar = (page: Page) => page.getByRole('region', { name: 'Bulk actions' });

test('Scenario: Compare three, by keyboard', async ({ page }) => {
  const table = await openRanking(page);
  await expect(bar(page)).toHaveCount(0);
  await table.getByRole('checkbox', { name: 'Select all 7 shown' }).focus();
  // The three top-ranked rows, one Tab and Space each (the name's link sits between two rows' boxes).
  for (const name of ['Sara Al Qahtani', 'Arjun Menon', 'Tarek Mansour']) {
    const box = table.getByRole('checkbox', { name: `Select ${name}` });
    await expect(async () => {
      await page.keyboard.press('Tab');
      await expect(box).toBeFocused({ timeout: 250 });
    }).toPass();
    await page.keyboard.press('Space');
    await expect(box).toBeChecked();
  }
  await expect(bar(page).getByRole('status')).toHaveText('3 selected');
  await expect(bar(page)).toContainText('Bulk actions always show a preview first.');
  // The URL carries opaque ids only, and the selection survives a reload.
  expect(new URL(page.url()).searchParams.get('selected')).toMatch(/^[0-9a-f-]{36}(,[0-9a-f-]{36}){2}$/);
  await page.reload();
  await expect(bar(page).getByRole('status')).toHaveText('3 selected');
  await bar(page).getByRole('button', { name: 'Compare' }).focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/app\/jobs\/[0-9a-f-]{36}\/compare\?ids=[0-9a-f-]{36}(,[0-9a-f-]{36}){2}$/);
});

test('Scenario: Compare needs two or three, and the selection survives a filter', async ({ page }) => {
  const table = await openRanking(page);
  for (const name of ['Sara Al Qahtani', 'Arjun Menon', 'Tarek Mansour', 'Daniel Novak'])
    await table.getByRole('checkbox', { name: `Select ${name}` }).check();
  await expect(bar(page).getByRole('status')).toHaveText('4 selected');
  await expect(bar(page).getByRole('button', { name: 'Compare up to 3 at a time' })).toBeDisabled();
  await page.getByRole('searchbox', { name: 'Search candidates' }).fill('menon');
  await expect(bar(page).getByRole('status')).toHaveText('4 selected · 3 not shown in the table');
});

for (const theme of themes) {
  test(`axe passes on the ranking with the bulk bar open (${theme})`, async ({ page, context, baseURL }) => {
    await context.addCookies([{ name: 'theme', value: theme, url: baseURL ?? '' }]);
    const table = await openRanking(page);
    await table.getByRole('checkbox', { name: 'Select Sara Al Qahtani' }).check();
    await expect(bar(page).getByRole('button', { name: 'Choose 2 or 3 to compare' })).toBeDisabled();
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await expectAccessible(page);
    await table.getByRole('checkbox', { name: 'Select Arjun Menon' }).check();
    await expect(bar(page).getByRole('button', { name: 'Compare' })).toBeEnabled();
    await expectAccessible(page);
  });
}
