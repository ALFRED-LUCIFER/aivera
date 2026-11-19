import { expect, test, type Browser, type Page } from '@playwright/test';
import { signIn } from './auth.ts';
import { expectNoAxeViolations, themes } from './gallery.ts';
import { approveAsOperator, PIA, signUpWorkspace } from './workspaces.ts';

// AIV-P2-037 (ADR-012): Pia Platform suspends and reactivates a workspace; its admin reads but cannot start work. Each
// run's admin creates a new workspace through the app (the Omar Agency persona, as a fresh synthetic address), so the
// seeded "Gulf Talent Partners", which other specs read in parallel, stays active. The worker, AI and email parts of the
// ticket have no code to stop yet (no worker, no AI call, no email); the server refusal is mutation-checked in the
// workspaces module and tests/integration/src/ops-status.test.ts. While new workspaces need approval (AIV-P2-039), the
// operator approves it first. Synthetic people only.

const BANNER = 'This workspace is paused by Aivera. You can read everything; new work is paused.';
const PREVIEW = 'Members can still read everything. New work, AI calls and emails stop. Nothing is deleted.';

/** A new workspace and its admin, signed in, in a browser context of their own. */
async function newWorkspace(browser: Browser, theme: (typeof themes)[number], baseURL: string) {
  const stamp = `${theme}-${Date.now()}`;
  const name = `Harbour Talent ${stamp}`;
  const { page, context } = await signUpWorkspace(browser, baseURL, `omar.agency+suspend-${stamp}@example.com`, name);
  await context.addCookies([{ name: 'theme', value: theme, url: baseURL }]);
  await approveAsOperator(browser, baseURL, name);
  return { page, name, close: () => context.close() };
}

async function openInConsole(page: Page, name: string) {
  await signIn(page, { email: PIA });
  await page.goto('/ops/workspaces');
  const search = page.getByRole('searchbox', { name: 'Search by workspace name' });
  await search.fill(name);
  await search.press('Enter');
  await page.getByRole('link', { name, exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
}

/** The operator actions history: the list that holds the reasons. */
const history = (page: Page) =>
  page.getByRole('list').filter({ hasText: 'Pilot ended on 30 Nov 2026' }).getByRole('listitem');
const suspendedEntry = (page: Page) => history(page).filter({ hasText: 'Pilot ended on 30 Nov 2026' });
const statusFact = (page: Page) => page.getByRole('term').filter({ hasText: 'Status' }).locator('+ dd');

for (const theme of themes) {
  test(`Feature: Suspend and reactivate a workspace, by keyboard (${theme})`, async ({
    browser,
    page,
    context,
    baseURL,
  }) => {
    const base = baseURL ?? '';
    const member = await newWorkspace(browser, theme, base);
    await context.addCookies([{ name: 'theme', value: theme, url: base }]);
    await openInConsole(page, member.name);
    await expect(statusFact(page)).toHaveText('Active');

    // Scenario: Suspending needs a reason and a confirmation
    const open = page.getByRole('button', { name: 'Suspend workspace' });
    await open.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: `Suspend ${member.name}?` });
    await expect(dialog).toContainText(PREVIEW);
    await expect(dialog).toContainText('Nothing changes until you confirm.');
    const confirm = dialog.getByRole('button', { name: 'Confirm' });
    await expect(confirm).toBeDisabled();
    await expectNoAxeViolations(page);
    await dialog.getByRole('textbox', { name: 'Reason' }).fill('Too short');
    await expect(confirm).toBeDisabled();

    // Scenario: A suspension is applied and audited
    await dialog.getByRole('textbox', { name: 'Reason' }).fill('Pilot ended on 30 Nov 2026');
    await expect(confirm).toBeEnabled();
    await confirm.focus();
    await page.keyboard.press('Enter');
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('status').filter({ hasText: 'Workspace suspended.' })).toBeVisible();
    await expect(statusFact(page)).toHaveText('Suspended');
    await expect(statusFact(page).locator('svg')).toBeVisible();
    await expect(suspendedEntry(page)).toHaveText(
      /^Suspended on \d{1,2} [A-Z][a-z]{2} \d{4} at \d{2}:\d{2} \(Asia\/Dubai\): Pilot ended on 30 Nov 2026$/,
    );
    await expectNoAxeViolations(page);

    // Scenario: Members of a suspended workspace can read but not start work
    await member.page.goto('/app/jobs');
    await expect(member.page.getByRole('heading', { level: 1, name: 'Jobs' })).toBeVisible();
    await expect(member.page.getByText(BANNER)).toBeVisible();
    // The operator's reason never reaches members.
    await expect(member.page.getByText('Pilot ended on 30 Nov 2026')).toHaveCount(0);
    await expectNoAxeViolations(member.page);
    const refused = await member.page.goto('/app/jobs/new');
    expect(refused?.status()).toBe(403);
    await expect(member.page.getByRole('heading', { level: 1, name: 'This workspace is paused.' })).toBeVisible();

    // Scenario: Non-operators cannot suspend: the admin is refused by the console, and the status is unchanged
    const href = new URL(page.url()).pathname;
    expect((await member.page.goto(href))?.status()).toBe(403);
    await page.reload();
    await expect(statusFact(page)).toHaveText('Suspended');

    // Scenario: Reactivating
    await page.getByRole('button', { name: 'Reactivate' }).click();
    const again = page.getByRole('dialog', { name: `Reactivate ${member.name}?` });
    await again.getByRole('textbox', { name: 'Reason' }).fill('Pilot extended to 31 Dec 2026');
    await again.getByRole('button', { name: 'Confirm' }).click();
    await expect(again).toBeHidden();
    await expect(statusFact(page)).toHaveText('Active');
    await expect(history(page)).toHaveText([
      /^Approved on \d{1,2} [A-Z][a-z]{2} \d{4} at \d{2}:\d{2} \(Asia\/Dubai\)$/,
      /^Suspended on .*: Pilot ended on 30 Nov 2026$/,
      /^Reactivated on .*: Pilot extended to 31 Dec 2026$/,
    ]);
    const reopened = await member.page.goto('/app/jobs/new');
    expect(reopened?.status()).toBe(200);
    await expect(member.page.getByText(BANNER)).toHaveCount(0);
    await member.close();
  });
}
