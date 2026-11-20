import { expect, test, type Page } from '@playwright/test';
import { signIn } from './auth.ts';
import { expectNoAxeViolations, themes } from './gallery.ts';

// AIV-P1-006: AP's workspace "Demo" has the five demo jobs (seed.ts); Nadia's workspace has none. Not Alex's
// "Demo Hiring Co", where the add-job spec adds jobs.
const AP = 'ap@example.com';

const row = (page: Page, title: string) =>
  page.getByRole('row').filter({ has: page.getByRole('link', { name: title }) });

test('Scenario: The seeded workspace shows five jobs', async ({ page }) => {
  await signIn(page, { email: AP });
  await page.goto('/app/jobs');
  // "Needs your action" counts only what is known: the draft rubric. Packs and evidence requests are not built yet.
  for (const name of ['All 5', 'Needs your action 1', 'Rubric not approved 1'])
    await expect(page.getByRole('radio', { name })).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: 'Jobs' })).toBeVisible();
  await expect(page.getByText('Every job runs on an approved rubric.', { exact: false })).toBeVisible();

  const sae = row(page, 'Senior AI Engineer');
  await expect(sae).toContainText('Engineering · DIFC, Dubai');
  await expect(sae.getByRole('cell')).toHaveText([
    'Senior AI EngineerEngineering · DIFC, Dubai',
    'Head of Engineering',
    'Round 1 interviews',
    'Not yet available',
    'Not yet available',
    'Approved',
    'Not yet available',
  ]);
  await expect(sae.getByRole('link')).toHaveAttribute('href', /^\/app\/jobs\/[0-9a-f-]+\/candidates$/);
});

test('Scenario: A job without an approved rubric is not assessed', async ({ page }) => {
  await signIn(page, { email: AP });
  await page.goto('/app/jobs');
  await expect(row(page, 'Senior Product Designer').getByRole('cell')).toHaveText([
    'Senior Product DesignerDesign · Abu Dhabi',
    'Design Director',
    'Defining rubric',
    '0Observed',
    'Starts after rubric approval',
    'Draft, needs approval',
    'Send rubric for approval',
  ]);
  await expect(row(page, 'Senior Product Designer').getByRole('link')).toHaveAttribute('href', /\/rubric$/);
});

// mutation check: made the rubricNotApproved filter match every row -> this test failed (the tab read "Rubric not approved 5")
test('Scenario: Filter to rubrics not approved, by keyboard, kept in the URL', async ({ page }) => {
  await signIn(page, { email: AP });
  await page.goto('/app/jobs');
  await expect(page.getByRole('radio', { name: 'All 5' })).toBeChecked();
  await page.getByRole('link', { name: 'Add a job' }).focus();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('radio', { name: 'All 5' })).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('radio', { name: 'Rubric not approved 1' })).toBeChecked();
  await expect(page).toHaveURL(/\?filter=rubricNotApproved$/);
  const links = page.getByRole('table', { name: 'Jobs' }).getByRole('link');
  await expect(links).toHaveText(['Senior Product Designer']);
  await page.reload();
  await expect(links).toHaveText(['Senior Product Designer']);
  // Tab moves on from the tabs into the table, to the job's link.
  await page.getByRole('radio', { name: 'Rubric not approved 1' }).focus();
  await page.keyboard.press('Tab');
  await expect(links.first()).toBeFocused();
});

test('Scenario: Empty workspace', async ({ page }) => {
  await signIn(page, { email: 'nadia@example.com' });
  await page.goto('/app/jobs');
  await expect(page.getByText('No jobs yet. Add a job to define what it needs.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Add a job' })).toHaveAttribute('href', '/app/jobs/new');
  await expect(page.getByRole('radio')).toHaveCount(0);
});

for (const theme of themes) {
  test(`axe passes on Jobs, populated and empty (${theme})`, async ({ page, context }) => {
    await context.addCookies([{ name: 'theme', value: theme, url: 'http://localhost:3200' }]);
    await signIn(page, { email: AP });
    await page.goto('/app/jobs');
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await expect(page.getByRole('radio', { name: 'All 5' })).toBeVisible();
    await expectNoAxeViolations(page);
    await expect(page).toHaveScreenshot(`jobs-list-${theme}.png`, { fullPage: true });
    await context.clearCookies({ name: '__Host-credalent-session' });
    await signIn(page, { email: 'nadia@example.com' });
    await page.goto('/app/jobs');
    await expect(page.getByText('No jobs yet. Add a job to define what it needs.')).toBeVisible();
    await expectNoAxeViolations(page);
  });
}
