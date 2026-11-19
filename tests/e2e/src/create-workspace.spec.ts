import { expect, test } from '@playwright/test';
import { signIn } from './auth.ts';
import { css, expectNoAxeViolations, themes } from './gallery.ts';

// AIV-P1-001 J1 step 1: a recruiter signs in with no workspace yet, creates one and lands in it. While new workspaces
// need approval (AIV-P2-039, on by default) it shows the waiting page; ops-approvals.spec.ts continues the journey.
// Each run signs in as a new synthetic address (Nadia, the solo recruiter persona), so a reused database works too.

for (const theme of themes) {
  test(`Scenario: A new workspace is created and I land in it (waiting for approval), from the keyboard (${theme})`, async ({
    page,
    context,
  }) => {
    await context.addCookies([{ name: 'theme', value: theme, url: 'http://localhost:3200' }]);
    await signIn(page, { email: `nadia+${theme}-${Date.now()}@example.com` });
    await expect(page.getByRole('heading', { level: 1, name: 'You are not in a workspace yet' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Or create your own workspace' })).toBeVisible();
    await expect(page.getByText('Optional', { exact: true })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await expectNoAxeViolations(page);

    // The ink panel's logo link comes first (SignUp artboard, AIV-P1-068).
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Aivera' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByLabel('Company')).toBeFocused();
    await page.keyboard.type('Demo Hiring Co');
    await page.keyboard.press('Tab');
    const focus = page.getByLabel('What do you hire for most?');
    await expect(focus).toBeFocused();
    await focus.selectOption({ label: 'AI and LLM engineering' });
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Create workspace' })).toBeFocused();
    await page.keyboard.press('Enter');

    await expect(page).toHaveURL(/\/app$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Waiting for approval' })).toBeVisible();
    await expectNoAxeViolations(page);
  });
}

test('a hiring focus is required before submitting', async ({ page }) => {
  await signIn(page, { email: `nadia+required-${Date.now()}@example.com` });
  await page.getByRole('button', { name: 'Create workspace' }).click();
  // The browser's own required check keeps the form on the page; nothing is created.
  await expect(page.getByRole('heading', { level: 1, name: 'You are not in a workspace yet' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'You are not in a workspace yet' })).toBeVisible();
});

// A refused submit (here a company over the server's 200-character limit, past the field's maxlength) takes the same
// path as a service error: the alert is announced and every field keeps what was typed.
test('Scenario: A failed create keeps what I typed', async ({ page }) => {
  await signIn(page, { email: `nadia+failed-${Date.now()}@example.com` });
  const company = page.getByLabel('Company');
  await company.evaluate((input) => input.removeAttribute('maxlength'));
  await company.fill('x'.repeat(201));
  await page.getByLabel('What do you hire for most?').selectOption({ label: 'Sales' });
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'We could not create your workspace. Try again.' }),
  ).toBeVisible();
  await expect(page.getByLabel('Company')).toHaveValue('x'.repeat(201));
  await expect(page.getByLabel('What do you hire for most?')).toHaveValue('sales');
});

// AIV-P1-068: the SignUp artboard's ink panel (logo, highlighted headline, three promises) in either theme, its 44 px
// fields and 48 px button, and no sideways scroll at phone width.
for (const theme of themes) {
  test(`the no-workspace page has the SignUp artboard's ink panel and sizes (${theme})`, async ({ page, context }) => {
    await context.addCookies([{ name: 'theme', value: theme, url: 'http://localhost:3200' }]);
    await page.setViewportSize({ width: 1440, height: 900 });
    await signIn(page, { email: `nadia+panel-${theme}-${Date.now()}@example.com` });
    const panel = page.getByRole('complementary');
    await expect(panel.getByRole('link', { name: 'Aivera' })).toHaveAttribute('href', '/');
    await expect(panel.locator('mark')).toHaveText('evidence');
    for (const point of [
      'Define a role and agree its competencies with the hiring manager.',
      'See candidates ranked by work you can inspect.',
      'Keep every hiring decision with a person.',
    ])
      await expect(panel.getByRole('listitem').filter({ hasText: point })).toBeVisible();
    expect(await css(panel, 'background-color')).toBe('rgb(29, 25, 34)');
    expect((await page.getByLabel('Company').boundingBox())?.height).toBe(44);
    expect((await page.getByLabel('What do you hire for most?').boundingBox())?.height).toBe(44);
    expect((await page.getByRole('button', { name: 'Create workspace' }).boundingBox())?.height).toBe(48);

    await page.setViewportSize({ width: 390, height: 800 });
    const [top, form] = [await panel.boundingBox(), await page.getByRole('main').boundingBox()];
    expect(top && form && top.y + top.height <= form.y).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}
