import { expect, test, type Page } from '@playwright/test';
import { signIn } from './auth.ts';
import { expectAccessible, themes } from './gallery.ts';

// AIV-P1-003, J1 step: Tariq, admin of the agency "Harbour Talent" (clients Falcon Pay and Dune Logistics, one job
// each), invites people on Members; Faisal opens the invitation seed.ts sent him to all of Dune Logistics' jobs.

const MEMBERS = '/app/settings/members';
const INVALID = 'This invitation is no longer valid. Ask your workspace admin for a new one.';
const token = () => process.env['E2E_INVITE_TOKEN'] ?? '';

const openMembers = async (page: Page) => {
  await signIn(page, { email: 'tariq.agency@example.com' });
  await page.goto(MEMBERS);
  await expect(page.getByRole('heading', { level: 1, name: 'Members' })).toBeVisible();
};
const row = (page: Page, ...texts: string[]) =>
  texts.reduce(
    (rows, text) => rows.filter({ hasText: text }),
    page.getByRole('table', { name: 'Members and open invitations' }).getByRole('row'),
  );
const invite = async (page: Page, email: string, role: string) => {
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Role', { exact: true }).selectOption({ label: role });
};
const send = (page: Page) => page.getByRole('button', { name: 'Send invitation' }).click();

test("Scenario: Invite a client's hiring owner to that client's jobs", async ({ page }) => {
  await openMembers(page);
  await invite(page, 'faisal@example.com', 'Hiring owner');
  await page.getByLabel('Job title').fill('Head of Engineering, Dune Logistics');
  await page.getByLabel("All of Dune Logistics' jobs").check();
  await send(page);
  await expect(
    page.getByText(/^Invitation sent to faisal@example\.com\. It expires on \d{1,2} \w{3} \d{4}\.$/),
  ).toBeVisible();
  // seed.ts invited Faisal too: the newest invitation is listed first.
  const invited = row(page, 'faisal@example.com', 'Invited').first();
  await expect(invited.getByRole('cell')).toHaveText([
    /faisal@example\.com/,
    'Hiring owner',
    'Dune Logistics',
    'Invited',
    /Revoke/,
  ]);
});

test('Scenario: Invite an interviewer to one job', async ({ page }) => {
  await openMembers(page);
  await invite(page, 'lina@example.com', 'Interviewer');
  await page.getByLabel('Staff Backend Engineer').check();
  await send(page);
  await expect(row(page, 'lina@example.com', 'Invited').getByRole('cell').nth(2)).toHaveText('Staff Backend Engineer');
});

test('Scenario: A hiring owner or interviewer needs at least one job', async ({ page }) => {
  await openMembers(page);
  await invite(page, 'huda@example.com', 'Hiring owner');
  await send(page);
  await expect(page.getByText('Choose the jobs this person works on.')).toBeVisible();
  await expect(row(page, 'huda@example.com')).toHaveCount(0);
});

test('Scenario: Recruiters and admins get the whole workspace', async ({ page }) => {
  await openMembers(page);
  await invite(page, 'omar.agency@example.com', 'Recruiter');
  await expect(page.getByRole('group', { name: 'Jobs this person works on' })).toHaveCount(0);
  await expect(page.getByText('Workspace admins and recruiters see every job.')).toBeVisible();
  await send(page);
  await expect(row(page, 'omar.agency@example.com', 'Invited').getByRole('cell').nth(2)).toHaveText('All jobs');
});

test('Scenario: The last admin cannot be removed', async ({ page }) => {
  await openMembers(page);
  const own = row(page, 'tariq.agency@example.com');
  await own.getByLabel('Role for tariq.agency@example.com').selectOption({ label: 'Recruiter' });
  await own.getByRole('button', { name: 'Change role' }).click();
  await expect(page.getByText('A workspace needs at least one admin.')).toBeVisible();
  await page.reload();
  await expect(row(page, 'tariq.agency@example.com').getByRole('cell').nth(1)).toHaveText('Workspace admin');
});

test('Settings leads an admin to Members', async ({ page }) => {
  await signIn(page, { email: 'tariq.agency@example.com' });
  await page.goto('/app/settings');
  await page.getByRole('link', { name: 'Members' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Members' })).toBeVisible();
});

test('only an admin opens Members: an interviewer gets the 403 page', async ({ page }) => {
  await signIn(page, { email: 'rami@example.com' });
  expect((await page.goto(MEMBERS))?.status()).toBe(403);
  await expect(page.getByRole('heading', { level: 1, name: 'Members' })).toHaveCount(0);
  await expect(page.getByText('You do not have access to this. Ask your workspace admin.')).toBeVisible();
});

test("Scenario: Accepting joins the workspace with the invited role and only that client's jobs", async ({
  page,
  browser,
  baseURL,
}) => {
  await page.goto(`/invite?token=${encodeURIComponent(token())}`);
  await expect(page.getByText('Harbour Talent invited you to Credalent as Hiring owner.')).toBeVisible();
  await page.getByRole('link', { name: 'Sign in or create an account' }).click();
  await expect(page).toHaveURL(/\/sign-in\?next=/);
  await signIn(page, { email: 'faisal@example.com' });
  await page.getByRole('button', { name: 'Join Harbour Talent' }).click();
  await expect(page).toHaveURL(/\/app$/);
  // Used now: the same link does nothing.
  await page.goto(`/invite?token=${encodeURIComponent(token())}`);
  await expect(page.getByText(INVALID)).toBeVisible();
  // Tariq sees Faisal as an active hiring owner on Dune Logistics' jobs only. Which jobs he can open is proven in
  // tests/integration (workspaces.test.ts): hiring owners have no recruiter screens yet (AIV-P1-014 adds theirs).
  const admin = await browser.newPage({ baseURL: baseURL ?? '' });
  await openMembers(admin);
  await expect(row(admin, 'faisal@example.com', 'Active').getByRole('cell')).toHaveText([
    /faisal@example\.com.*Head of Engineering, Dune Logistics/,
    'Hiring owner',
    'Dune Logistics',
    'Active',
    /Change role/,
  ]);
  await admin.close();
});

test('Scenario Outline: a link that matches no invitation does nothing', async ({ page }) => {
  await page.goto('/invite?token=not-a-real-token');
  await expect(page.getByRole('heading', { level: 1, name: 'Invitation not valid' })).toBeVisible();
  await expect(page.getByText(INVALID)).toBeVisible();
});

test("Scenario: Changing a member's jobs: Edit jobs uses the same picker", async ({ page }) => {
  await openMembers(page);
  await page.getByRole('button', { name: 'Edit jobs for rami@example.com' }).click();
  const dialog = page.getByRole('dialog', { name: 'Jobs for rami@example.com' });
  await expect(dialog.getByLabel('Staff Backend Engineer')).toBeChecked();
  await dialog.getByLabel('Staff Backend Engineer').uncheck();
  await dialog.getByLabel('Senior Product Manager, Payments').check();
  await dialog.getByRole('button', { name: 'Save jobs' }).click();
  await expect(dialog).toBeHidden();
  await expect(row(page, 'rami@example.com').getByRole('cell').nth(2)).toHaveText('Senior Product Manager, Payments');
});

// AIV-P2-060 Scenario: The active-workspace pointer follows membership. Lina's active workspace was Gulf Talent Partners
// until she was removed from it (seed.ts), so she lands on her other workspace, Harbour Talent; removed from that too,
// she has none and gets the no-workspace page, never the 403 page. The mutation-checked proof is workspaces.test.ts.
test('removing a member asks first, then takes them off the list and out of the workspace', async ({
  page,
  browser,
  baseURL,
}) => {
  const lina = await browser.newPage({ baseURL: baseURL ?? '' });
  await signIn(lina, { email: 'lina@example.com' });
  await lina.goto('/app/jobs');
  await expect(lina.getByRole('heading', { level: 1, name: 'Jobs' })).toBeVisible();
  // Harbour Talent's jobs, not Gulf's: the shell names no workspace yet (AIV-P1-055), but only Harbour's carry clients.
  await expect(
    lina.getByRole('row').filter({ hasText: 'Senior Product Manager, Payments' }).filter({ hasText: 'Falcon Pay' }),
  ).toHaveCount(1);

  await openMembers(page);
  await page.getByRole('button', { name: 'Remove lina@example.com' }).click();
  const dialog = page.getByRole('dialog', { name: 'Remove lina@example.com?' });
  await expect(dialog.getByText('They lose access to this workspace on their next request.')).toBeVisible();
  await dialog.getByRole('button', { name: 'Remove member' }).click();
  await expect(dialog).toBeHidden();
  await expect(row(page, 'lina@example.com', 'Active')).toHaveCount(0);

  await lina.goto('/app/jobs');
  await expect(lina.getByRole('heading', { level: 1, name: 'You are not in a workspace yet' })).toBeVisible();
  await expect(lina.getByRole('heading', { level: 1, name: 'Jobs' })).toHaveCount(0);
  await lina.close();
});

test('revoking an invitation takes it off the list', async ({ page }) => {
  await openMembers(page);
  await invite(page, 'sara@example.com', 'Recruiter');
  await send(page);
  await expect(row(page, 'sara@example.com', 'Invited')).toHaveCount(1);
  await page.getByRole('button', { name: 'Revoke the invitation for sara@example.com' }).click();
  await expect(row(page, 'sara@example.com')).toHaveCount(0);
});

for (const theme of themes) {
  test(`axe passes on the Edit jobs and Remove dialogs, from the keyboard (${theme})`, async ({
    page,
    context,
    baseURL,
  }) => {
    await context.addCookies([{ name: 'theme', value: theme, url: baseURL ?? '' }]);
    await openMembers(page);
    const edit = page.getByRole('button', { name: /^Edit jobs for / }).first();
    await edit.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expectAccessible(page);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await page
      .getByRole('button', { name: /^Remove / })
      .first()
      .click();
    await expect(dialog).toBeVisible();
    await expectAccessible(page);
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
  });
}

for (const theme of themes) {
  test(`axe passes on Members and the invitation page (${theme})`, async ({ page, context, baseURL }) => {
    await context.addCookies([{ name: 'theme', value: theme, url: baseURL ?? '' }]);
    await openMembers(page);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await expectAccessible(page);
    await page.getByLabel('Role', { exact: true }).selectOption({ label: 'Interviewer' });
    await expectAccessible(page);
    await page.goto('/invite?token=not-a-real-token');
    await expectAccessible(page);
    await context.clearCookies({ name: '__Host-credalent-session' });
    await page.goto(`/invite?token=${encodeURIComponent(token())}`);
    await expect(page.getByText(/invited you to Credalent|no longer valid/)).toBeVisible();
    await expectAccessible(page);
  });
}

test('Members works from the keyboard: Tab reaches the invite form and sends it', async ({ page }) => {
  await openMembers(page);
  await page.getByLabel('Email').focus();
  await page.keyboard.type('nadia@example.com');
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('Role', { exact: true })).toBeFocused();
  await page.getByLabel('Role', { exact: true }).selectOption({ label: 'Recruiter' });
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('Job title')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Send invitation' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByText(/^Invitation sent to nadia@example\.com\. It expires on /)).toBeVisible();
});
