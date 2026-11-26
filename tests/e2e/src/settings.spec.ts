import { expect, test, type Page } from '@playwright/test';
import { signIn } from './auth.ts';
import { expectAccessible, themes } from './gallery.ts';

// AIV-P1-052 J1: the workspace settings screen. seed.ts: Alex is the admin of Demo Hiring Co (all defaults); Zaid is a
// recruiter in Oasis Talent.

const SAVED = 'Settings saved. New links, invitations and sessions use them. Existing ones keep their expiry.';
const shortlist = (page: Page) => page.getByRole('textbox', { name: 'Client shortlist link lasts', exact: true });
const save = (page: Page) => page.getByRole('button', { name: 'Save settings' });

/**
 * Edits and saves until the form answers. The server renders the form with its values, so a field can be typed into
 * before React hydrates; hydration then keeps the loaded value in state and the save sends that (CI run 45877523565:
 * the out-of-range save sent "12", passing on retry). Each try edits again, so the first one after hydration counts.
 * Saving the same values again changes nothing.
 */
const editAndSave = (page: Page, edit: () => Promise<void>, answered: () => Promise<void>) =>
  expect(async () => {
    await edit();
    await save(page).click();
    await answered();
  }).toPass();

async function openFromSidebar(page: Page, email: string) {
  await signIn(page, { email });
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
}

for (const theme of themes)
  test(`Scenario: An admin sees every setting with its current value and range, by keyboard (${theme})`, async ({
    page,
    context,
    baseURL,
  }) => {
    await context.addCookies([{ name: 'theme', value: theme, url: baseURL ?? '' }]);
    await openFromSidebar(page, 'alex@example.com');
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    for (const group of [
      'Sharing and invitations',
      'Sign-in',
      'Candidates and evidence',
      'Interviews',
      'Value dashboard',
      'Candidate feedback',
    ])
      await expect(page.getByRole('group', { name: group })).toBeVisible();
    await expect(shortlist(page)).toHaveValue('14');
    await expect(shortlist(page)).toHaveAccessibleDescription(/1 to 30 days/);
    await expect(page.getByRole('button', { name: /^Save settings$/ })).toHaveCount(1);
    await expectAccessible(page);

    // Keyboard: from the first field, Tab reaches the next field and, at the end, the one primary button.
    await shortlist(page).focus();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('textbox', { name: 'Team invitations last', exact: true })).toBeFocused();
    await page.getByLabel('Tell candidates which competencies fell short', { exact: false }).focus();
    await page.keyboard.press('Tab');
    await expect(save(page)).toBeFocused();
  });

test('Scenarios: Saving a change, a value out of range, restore a default', async ({ page }) => {
  await openFromSidebar(page, 'alex@example.com');

  // A value out of range is explained, not saved.
  const idle = page.getByRole('textbox', { name: 'Sign out after inactivity', exact: true });
  await editAndSave(
    page,
    () => idle.fill('24'),
    () => expect(idle).toHaveAccessibleDescription(/Enter a number from 1 to 12/, { timeout: 1000 }),
  );
  await expect(idle).toHaveAttribute('aria-invalid', 'true');
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Sign out after inactivity', exact: true })).toHaveValue('12');

  // Saving a change.
  await editAndSave(
    page,
    () => shortlist(page).fill('7'),
    async () => {
      await expect(page.getByText(SAVED)).toBeVisible({ timeout: 1000 });
      await expect(shortlist(page)).toHaveValue('7', { timeout: 1000 });
    },
  );
  await page.reload();
  await expect(shortlist(page)).toHaveValue('7');
  await expect(page.getByText('Default: 14')).toBeVisible();
  await expectAccessible(page);

  // Restore a default.
  await editAndSave(
    page,
    () => page.getByRole('button', { name: 'Use default for Client shortlist link lasts' }).click(),
    async () => {
      await expect(page.getByText(SAVED)).toBeVisible({ timeout: 1000 });
      await expect(shortlist(page)).toHaveValue('14', { timeout: 1000 });
    },
  );
  await page.reload();
  await expect(shortlist(page)).toHaveValue('14');
  await expect(page.getByText(/^Default:/)).toHaveCount(0);
});

test('Scenario: Other roles can read but not change', async ({ page }) => {
  await openFromSidebar(page, 'zaid@example.com');
  await expect(page.getByText('Only an admin can change these settings')).toBeVisible();
  await expect(shortlist(page)).toHaveValue('14');
  await expect(shortlist(page)).toHaveAttribute('readonly', '');
  await expect(save(page)).toHaveCount(0);
  await expectAccessible(page);
});
