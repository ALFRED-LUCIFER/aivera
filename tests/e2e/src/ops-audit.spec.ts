import { createAudit } from '@credalent/audit/composition';
import { createDb } from '@credalent/db/client';
import { expect, test, type Page } from '@playwright/test';
import { databaseUrl } from '../playwright.config.ts';
import { signIn } from './auth.ts';
import { expectAccessible, themes } from './gallery.ts';
import { approvedWorkspace } from './workspaces.ts';

// AIV-P2-054 (ADR-012 point 8): the platform audit log at /ops/audit. Other specs write to the same log in parallel, so
// each test makes its own workspace (Pia Platform approves it) and filters by its opaque id: only this test's entries.
// The mock tenant names the operators "pia.platform" and "theo.platform". Synthetic people only (personas.md).
// "Catalogue published" is not a platform action yet (the catalogue publish ticket adds it with its name and version).

const THEO = 'theo.platform@example.com';

/** A new workspace that Pia approved, and its opaque id as Theo finds it on /ops/workspaces (no visit recorded). */
async function auditedWorkspace(page: Page, stamp: string) {
  const name = `Audit Trail ${stamp}`;
  await approvedWorkspace(`omar.agency+audit-${stamp}@example.com`, name);
  await signIn(page, { email: THEO });
  await page.goto('/ops/workspaces');
  const search = page.getByRole('searchbox', { name: 'Search by workspace name' });
  await search.fill(name);
  await search.press('Enter');
  const href = await page.getByRole('link', { name, exact: true }).getAttribute('href');
  const id = href?.split('/').at(-1) ?? '';
  expect(id).toMatch(/^[0-9a-f-]{36}$/);
  return { name, id };
}

const rows = (page: Page) => page.getByRole('table', { name: 'Platform audit log' }).locator('tbody tr');
const params = (page: Page) => Object.fromEntries(new URL(page.url()).searchParams);

async function apply(page: Page) {
  const button = page.getByRole('button', { name: 'Apply filters' });
  await button.focus();
  await page.keyboard.press('Enter');
}

for (const theme of themes) {
  test(`Feature: Platform audit log viewer: newest first, filters, link to the workspace, by keyboard (${theme})`, async ({
    page,
    context,
    baseURL,
  }) => {
    const base = baseURL ?? '';
    const workspace = await auditedWorkspace(page, `${theme}-${Date.now()}`);
    // Read once: a run that crosses UTC midnight still filters the day its entries were written.
    const today = new Date().toISOString().slice(0, 10);
    await context.addCookies([{ name: 'theme', value: theme, url: base }]);
    const urls: string[] = [];
    page.on('request', (request) => urls.push(decodeURIComponent(request.url())));
    // Theo opens the workspace: the log's newest entry for it.
    await page.goto(`/ops/workspaces/${workspace.id}`);
    await expect(page.getByRole('heading', { level: 1, name: workspace.name })).toBeVisible();

    // The sidebar's "Audit log" section, by keyboard.
    await page.goto('/ops');
    const nav = page.getByRole('navigation', { name: 'Operations' }).getByRole('link', { name: 'Audit log' });
    await nav.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { level: 1, name: 'Audit log' })).toBeVisible();
    await expect(page).toHaveTitle('Audit log');
    await expect(nav).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await expectAccessible(page);

    // Scenario: The log lists entries newest first (this workspace's entries, by its target id)
    await page.getByLabel('Target id').fill(workspace.id);
    await apply(page);
    await expect(page).toHaveURL(`/ops/audit?target=${workspace.id}`);
    await expect(rows(page)).toHaveCount(2);
    const link = `Workspace ${workspace.id}`;
    await expect(rows(page).nth(0).getByRole('cell')).toHaveText([
      /^\d{4}-\d{2}-\d{2} \d{2}:\d{2} \(UTC\)$/,
      'theo.platform',
      'Workspace opened',
      link,
      'None',
      'None',
    ]);
    await expect(rows(page).nth(1).getByRole('cell')).toHaveText([
      /\(UTC\)$/,
      'pia.platform',
      'Approved',
      link,
      'None',
      'Status: Waiting for approval → Active',
    ]);
    await expectAccessible(page);

    // Scenario Outline: Filters narrow the list: operator, as her opaque id (Scenario: No personal data in URLs)
    await page.getByLabel('Operator').selectOption({ label: 'pia.platform' });
    await apply(page);
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page).getByRole('cell').nth(2)).toHaveText('Approved');
    expect(Object.keys(params(page))).toEqual(['actor', 'target']);
    expect(params(page)['actor']).toMatch(/^[0-9a-f-]{36}$/);

    // From and to as UTC days.
    await page.getByLabel('Operator').selectOption({ label: 'Any operator' });
    await page.getByLabel('From (UTC)').fill(today);
    await page.getByLabel('To (UTC)').fill(today);
    await apply(page);
    await expect(page).toHaveURL(`/ops/audit?target=${workspace.id}&from=${today}&to=${today}`);
    await expect(rows(page)).toHaveCount(2);

    // An action alone: the URL carries only its key.
    await page.getByRole('link', { name: 'Clear filters' }).click();
    await expect(page).toHaveURL('/ops/audit');
    await page.getByLabel('Action').selectOption({ label: 'Approved' });
    await apply(page);
    await expect(page).toHaveURL('/ops/audit?action=workspace.approved');
    await expect(rows(page).first()).toBeVisible();
    for (const action of await rows(page).locator('td:nth-child(3)').allTextContents()) expect(action).toBe('Approved');

    // The target links to the workspace.
    await page.goto(`/ops/audit?target=${workspace.id}`);
    await rows(page).nth(1).getByRole('link', { name: link }).click();
    await expect(page.getByRole('heading', { level: 1, name: workspace.name })).toBeVisible();

    expect(urls.filter((url) => /(pia|theo)\.platform|example\.com/i.test(url))).toEqual([]);
  });
}

test('Scenario: Pagination: 60 entries show as 50 and "Next page" with the remaining 10', async ({ page }) => {
  const workspace = await auditedWorkspace(page, `page-${Date.now()}`);
  // Pia's approval and 59 more entries by her: 60 for this workspace. Written through the audit module, not 59 page
  // loads: those flooded the one dev server and timed out the other worker's tests. The feature test above proves a
  // page view records its entry.
  const db = createDb(databaseUrl, { max: 1 });
  try {
    const audit = createAudit(db);
    const [approval] = (await audit.listPlatformEntries({ targetId: workspace.id })).entries;
    expect(approval?.action).toBe('workspace.approved');
    for (let i = 0; i < 59; i++)
      await audit.recordPlatform({
        actorId: approval?.actorId ?? '',
        action: 'ops.workspace_viewed',
        subject: { type: 'workspace', id: workspace.id },
      });
  } finally {
    await db.$client.end();
  }
  await page.goto(`/ops/audit?target=${workspace.id}`);
  await expect(rows(page)).toHaveCount(50);
  const next = page.getByRole('link', { name: 'Next page' });
  await next.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new RegExp(`target=${workspace.id}&cursor=[0-9a-f-]{36}$`));
  await expect(rows(page)).toHaveCount(10);
  await expect(rows(page).last().getByRole('cell').nth(2)).toHaveText('Approved');
  await expect(page.getByRole('link', { name: 'Next page' })).toHaveCount(0);
});

test('Scenario: No entry matches: an empty page says so', async ({ page }) => {
  await signIn(page, { email: THEO });
  await page.goto('/ops/audit?target=0190d4a2-0000-7000-8000-00000000ffff');
  await expect(page.getByRole('cell', { name: 'No entries match these filters.' })).toBeVisible();
  // An empty or malformed parameter leaves the URL.
  await page.goto('/ops/audit?action=&actor=pia.platform%40example.com&target=0190d4a2-0000-7000-8000-00000000ffff');
  await expect(page).toHaveURL('/ops/audit?target=0190d4a2-0000-7000-8000-00000000ffff');
});

// SAFETY: mutation check: removed `await platformOperator()` from the /ops layout, the audit page and listPlatformAudit -> this test failed (200)
test('Scenario: Only operators can read the log: a recruiter gets 403', async ({ page }) => {
  await signIn(page, { email: 'alex@example.com' });
  const response = await page.goto('/ops/audit');
  expect(response?.status()).toBe(403);
  // No log data: not the filter form, not an operator's name. (The loading state's static heading and caption are in
  // the streamed payload, as for every console page with a loading.tsx; they hold no data.)
  expect(await response?.text()).not.toMatch(/Filter the audit log|pia\.platform|theo\.platform|Any operator/);
});
