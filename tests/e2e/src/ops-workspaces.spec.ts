import { expect, test, type Page } from '@playwright/test';
import { signIn } from './auth.ts';
import { expectNoAxeViolations, themes } from './gallery.ts';

// AIV-P2-036 (ADR-012): the operator console's workspaces list and detail. seed.ts gives Demo Hiring Co (3 members,
// synthetic), Gulf Talent Partners (an agency, 4 active members, 2 jobs) and Nadia Freelance; every seeded workspace is
// synthetic. A reused local database holds earlier runs' copies too, so rows are found by searching their name.
// The empty, slow and failed states are component tests (WorkspacesList.test.tsx). Synthetic people only.

const PIA = 'pia.platform@example.com';
const noAccess = 'You do not have access to this. Ask your workspace admin.';
const ID = /\/ops\/workspaces\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const table = (page: Page) => page.getByRole('table', { name: 'Workspaces' });
// The seeded row: every seeded workspace is synthetic, while create-workspace.spec.ts adds a real "Demo Hiring Co".
const rowOf = (page: Page, name: string) =>
  table(page)
    .getByRole('row')
    .filter({ has: page.getByRole('link', { name, exact: true }), hasText: 'Synthetic' })
    .first();

async function openList(page: Page) {
  await signIn(page, { email: PIA });
  const response = await page.goto('/ops/workspaces');
  expect(response?.status()).toBe(200);
  await expect(page.getByRole('heading', { level: 1, name: 'Workspaces' })).toBeVisible();
}

async function search(page: Page, name: string) {
  await page.getByRole('searchbox', { name: 'Search by workspace name' }).fill(name);
  await page.getByRole('searchbox', { name: 'Search by workspace name' }).press('Enter');
  await expect(table(page)).not.toHaveAttribute('aria-busy', 'true');
}

test('Scenario: Listing workspaces', async ({ page }) => {
  await openList(page);
  await expect(page).toHaveTitle('Workspaces');
  await expect(table(page).getByRole('columnheader')).toHaveText([
    'Workspace',
    'Type',
    'Created (Asia/Dubai)',
    'Members',
    'Jobs',
    'AI tokens today',
    'Status',
    'Plan',
  ]);
  for (const name of ['Demo Hiring Co', 'Gulf Talent Partners', 'Nadia Freelance']) {
    await search(page, name);
    const cells = rowOf(page, name).getByRole('cell');
    await expect(cells.nth(2)).toHaveText(/^\d{1,2} [A-Z][a-z]{2} \d{4}$/);
    await expect(cells.nth(5)).toHaveText(/^[\d,]+Observed$/);
    await expect(cells.nth(6)).toHaveText('Active');
    await expect(cells.nth(7)).toHaveText('No plan yet');
  }
  await search(page, 'Demo Hiring Co');
  await expect(rowOf(page, 'Demo Hiring Co').getByRole('cell')).toHaveText([
    'Demo Hiring CoSynthetic',
    'In-house team',
    /\d{4}$/,
    '3',
    /^\d+$/,
    '1,500Observed',
    'Active',
    'No plan yet',
  ]);
});

test('Scenario: Searching by name', async ({ page }) => {
  const requested: string[] = [];
  page.on('request', (request) => requested.push(request.url()));
  await openList(page);
  await search(page, 'gulf');
  const links = table(page).getByRole('row').getByRole('link');
  await expect(links.first()).toHaveText('Gulf Talent Partners');
  expect(new Set(await links.allTextContents())).toEqual(new Set(['Gulf Talent Partners']));
  // The search went in the request body: neither the page URL nor any request URL holds it.
  expect(page.url()).not.toContain('gulf');
  expect(requested.filter((url) => /gulf/i.test(decodeURIComponent(url)))).toEqual([]);
});

test('Scenario Outline: States: the search matches nothing', async ({ page }) => {
  await openList(page);
  await search(page, 'zzz');
  await expect(table(page)).toContainText('No workspace matches "zzz".');
});

test('Scenario: Opening a workspace, by keyboard', async ({ page }) => {
  await openList(page);
  await page.getByRole('searchbox', { name: 'Search by workspace name' }).focus();
  await page.keyboard.type('Gulf Talent Partners');
  await page.keyboard.press('Enter');
  await expect(table(page)).not.toHaveAttribute('aria-busy', 'true');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Search' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Gulf Talent Partners' }).first()).toBeFocused();
  await page.keyboard.press('Enter');

  await expect(page).toHaveURL(ID);
  await expect(page.getByRole('heading', { level: 1, name: 'Gulf Talent Partners' })).toBeVisible();
  const facts = page.getByRole('definition');
  // The AI token use card is the main column; the platform facts sit beside it.
  await expect(page.getByRole('term')).toHaveText([
    'AI tokens today',
    'Daily AI budget',
    'Type',
    'Created (Asia/Dubai)',
    'Members',
    'Jobs',
    'Status',
    'Plan',
  ]);
  await expect(facts).toHaveText([
    '0 of 2,000,000Observed',
    '2,000,000 (platform default)',
    'Agency',
    /\d{4}$/,
    '4',
    '2',
    'Active',
    'No plan yet',
  ]);
  await expect(page.getByText('No operator actions yet.')).toBeVisible();
  // The "ops.workspace_viewed" entry is written by the page on the server ([id]/page.test.tsx) into the insert-only
  // platform log (tests/integration/src/ops-reads.test.ts).
  await page.getByRole('link', { name: 'Workspaces' }).first().click();
  await expect(page).toHaveURL(/\/ops\/workspaces$/);
});

test('Scenario: The console never returns candidate data', async ({ page }) => {
  await openList(page);
  await search(page, 'Demo Hiring Co');
  await rowOf(page, 'Demo Hiring Co').getByRole('link').click();
  await expect(page).toHaveURL(ID);
  const response = await page.request.get(page.url());
  const html = await response.text();
  expect(html).toContain('Demo Hiring Co');
  // No member value: not the seeded members' names or emails (the page holds counts only). The shell shows the
  // signed-in operator their own email (AIV-P2-052), so that one address is taken out first; any other email fails.
  // SAFETY: mutation check: WorkspaceDetail rendered "alex@example.com" -> this test failed
  expect(html.replaceAll(PIA, '')).not.toMatch(/Alex Recruiter|Rami Panel|Head of Engineering|@example\.com/);
});

// The server action and detail page refuse on their own too (searchWorkspaces.test.ts, [id]/page.test.tsx).
test('Scenario: Non-operators are refused', async ({ page, context }) => {
  await openList(page);
  await search(page, 'Gulf Talent Partners');
  const href = (await rowOf(page, 'Gulf Talent Partners').getByRole('link').getAttribute('href')) ?? '';
  expect(href).toMatch(ID);
  await context.clearCookies({ name: '__Host-credalent-session' });
  await signIn(page, { email: 'alex@example.com' });
  for (const path of ['/ops/workspaces', href]) {
    const response = await page.goto(path);
    expect(response?.status()).toBe(403);
    await expect(page.getByText(noAccess)).toBeVisible();
    const html = (await response?.text()) ?? '';
    expect(html).not.toMatch(/Gulf Talent Partners|Demo Hiring Co|No plan yet|Created \(/);
  }
});

for (const theme of themes) {
  test(`axe passes on the workspaces list and a detail page (${theme})`, async ({ page, context, baseURL }) => {
    await context.addCookies([{ name: 'theme', value: theme, url: baseURL ?? '' }]);
    await openList(page);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await search(page, 'Demo Hiring Co');
    await expectNoAxeViolations(page);
    await rowOf(page, 'Demo Hiring Co').getByRole('link').click();
    await expect(page.getByRole('heading', { level: 2, name: 'Platform facts' })).toBeVisible();
    await expectNoAxeViolations(page);
  });
}
