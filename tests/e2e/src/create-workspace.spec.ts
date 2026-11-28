import { expect, test } from '@playwright/test';
import { signIn } from './auth.ts';
import { css, expectAccessible, primaryButtons, themes } from './gallery.ts';
import { WAITING } from './workspaces.ts';

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
    // AIV-P1-165 "Someone with no workspace is offered to create one first": the one primary action, with asking an
    // admin as the secondary line below it.
    await expect(page.getByRole('heading', { level: 1, name: 'Create your workspace' })).toBeVisible();
    const create = page.getByRole('button', { name: 'Create your workspace' });
    await expect(primaryButtons(page)).toHaveText(['Create your workspace']);
    const ask = page.getByText('Joining a team instead? Ask your workspace admin to add you to their workspace.');
    expect((await ask.boundingBox())?.y).toBeGreaterThan((await create.boundingBox())?.y ?? Infinity);
    // AIV-P1-165 "Creating a workspace asks only what it needs": an example mail host pre-fills no company, and both
    // fields are marked optional.
    await expect(page.getByLabel('Company')).toHaveValue('');
    await expect(page.getByText('Optional', { exact: true })).toHaveCount(2);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await expectAccessible(page);

    // The ink panel's logo link comes first (SignUp artboard, AIV-P1-068).
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Credalent' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByLabel('Company')).toBeFocused();
    await page.keyboard.type('Demo Hiring Co');
    await page.keyboard.press('Tab');
    const focus = page.getByLabel('What do you hire for most?');
    await expect(focus).toBeFocused();
    await focus.selectOption({ label: 'AI and LLM engineering' });
    await page.keyboard.press('Tab');
    await expect(create).toBeFocused();
    await page.keyboard.press('Enter');

    // AIV-P1-165 "Waiting for approval says what happens next".
    await expect(page).toHaveURL(/\/app$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Waiting for approval' })).toBeVisible();
    await expect(page.getByText(WAITING)).toBeVisible();
    await expectAccessible(page);
    // Operator approval is still required before any job can be added: every recruiter route shows the waiting page.
    await page.goto('/app/jobs/new');
    await expect(page.getByRole('heading', { level: 1, name: 'Waiting for approval' })).toBeVisible();
    await expect(page.getByLabel('Job title')).toHaveCount(0);
    // She can sign out from that screen, from the keyboard.
    await page.getByRole('button', { name: 'Sign out' }).focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/sign-in/);
  });
}

test('Scenario: "What do you hire for most?" can be left blank', async ({ page }) => {
  await signIn(page, { email: `nadia+blank-${Date.now()}@example.com` });
  await expect(page.getByLabel('What do you hire for most?')).toHaveValue('');
  await page.getByRole('button', { name: 'Create your workspace' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Waiting for approval' })).toBeVisible();
});

// A refused submit (here a company over the server's 200-character limit, past the field's maxlength) takes the same
// path as a service error: the alert is announced and every field keeps what was typed.
test('Scenario: A failed create keeps what I typed', async ({ page }) => {
  await signIn(page, { email: `nadia+failed-${Date.now()}@example.com` });
  const company = page.getByLabel('Company');
  await company.evaluate((input) => input.removeAttribute('maxlength'));
  await company.fill('x'.repeat(201));
  await page.getByLabel('What do you hire for most?').selectOption({ label: 'Sales' });
  await page.getByRole('button', { name: 'Create your workspace' }).click();
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
    await expect(panel.getByRole('link', { name: 'Credalent' })).toHaveAttribute('href', '/');
    await expect(panel.locator('mark')).toHaveText('evidence');
    for (const point of [
      'Define a job and agree its competencies with the hiring owner.',
      'See candidates ranked by work you can inspect.',
      'Keep every hiring decision with a person.',
    ])
      await expect(panel.getByRole('listitem').filter({ hasText: point })).toBeVisible();
    expect(await css(panel, 'background-color')).toBe('rgb(29, 25, 34)');
    const title = page.getByRole('heading', { level: 1, name: 'Create your workspace' });
    expect(await css(title.locator('..').locator('..'), 'max-width')).toBe('440px');
    expect((await page.getByLabel('Company').boundingBox())?.height).toBe(44);
    expect((await page.getByLabel('What do you hire for most?').boundingBox())?.height).toBe(44);
    expect((await page.getByRole('button', { name: 'Create your workspace' }).boundingBox())?.height).toBe(48);

    await page.setViewportSize({ width: 390, height: 800 });
    const [top, form] = [await panel.boundingBox(), await page.getByRole('main').boundingBox()];
    expect(top && form && top.y + top.height <= form.y).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}
