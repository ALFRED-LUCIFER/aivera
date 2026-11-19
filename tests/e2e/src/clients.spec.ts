import { expect, test, type Page } from '@playwright/test';
import { signIn } from './auth.ts';
import { expectNoAxeViolations, themes } from './gallery.ts';

// AIV-P1-056 J1 step 3, agency variant (the ticket's archive examples use Dune Logistics, which has the job). seed.ts: Zaid is a recruiter in the agency Oasis Talent (no clients yet), where
// Faisal Client is a hiring owner with no grants; Alex's Demo Hiring Co is an in-house team. The fake model drafts from
// tests/e2e/ai-fixtures.json (the senior-ai-engineer description).

const ZAID = 'zaid@example.com';
const DESCRIPTION =
  'You will ship and run LLM assistants and retrieval systems that real merchants use every day. You will build ' +
  'the eval sets and retrieval metrics that decide what we ship. You will write production Python services, with ' +
  'tests, and deploy them yourself. You keep latency, cost per request and incidents in check. ' +
  'The assistant answers merchants in Arabic and English.';

const clientRow = (page: Page, name: string) =>
  page.getByRole('table', { name: 'Clients' }).getByRole('row').filter({ hasText: name });

async function addClient(page: Page, name: string) {
  await page.getByLabel('Client name').fill(name);
  await page.getByRole('button', { name: 'Add client' }).click();
  await expect(clientRow(page, name)).toContainText('0 open jobs');
}

test('Scenarios: add clients, pick one on Add a job with a hiring owner, archive one', async ({ page }) => {
  await signIn(page, { email: ZAID });
  await page.goto('/app/settings');
  await page.getByRole('link', { name: 'Clients' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Clients' })).toBeVisible();

  // Scenario: Add a client.
  await addClient(page, 'Falcon Pay');
  await addClient(page, 'Dune Logistics');
  await expect(page.getByText('Client added.')).toBeVisible();

  // Scenario: Pick the client on Add a job, and the hiring owner (who is granted that job, tests/integration jobs.test.ts).
  await page.goto('/app/jobs/new');
  const picker = page.getByLabel('Team or client');
  await expect(picker.locator('option')).toHaveText(['Our team', 'Dune Logistics', 'Falcon Pay']);
  await page.getByLabel('Job type').selectOption({ label: 'AI and LLM engineering' });
  await page.getByLabel('Job title').fill('Staff Backend Engineer');
  await page.getByLabel('Job description').fill(DESCRIPTION);
  await picker.selectOption({ label: 'Dune Logistics' });
  await page.getByLabel('Hiring owner').selectOption({ label: 'Faisal Client' });
  await page.getByRole('button', { name: 'Draft competencies' }).click();
  await expect(page.getByRole('heading', { name: 'Missing from your description · 2 suggestions' })).toBeVisible();
  await page.getByRole('button', { name: 'Save job and rubric' }).click();
  await page.getByRole('link', { name: 'Back to Jobs' }).click();
  const jobRow = page.getByRole('row').filter({ has: page.getByRole('link', { name: 'Staff Backend Engineer' }) });
  await expect(jobRow.getByRole('cell').nth(1)).toHaveText('Dune Logistics');
  await expect(jobRow).toContainText('Faisal Client');

  // The Client filter.
  await page.getByLabel('Client', { exact: true }).selectOption({ label: 'Dune Logistics' });
  await expect(jobRow).toBeVisible();

  // Scenario: Archiving asks for confirmation, by keyboard: Escape cancels and returns focus to the button.
  await page.goto('/app/settings/clients');
  await expect(clientRow(page, 'Dune Logistics')).toContainText('1 open job');
  const archive = page.getByRole('button', { name: 'Archive Dune Logistics' });
  await archive.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Archive Dune Logistics?' });
  await expect(dialog).toContainText('Its jobs stay as they are. You cannot add new jobs for this client.');
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(archive).toBeFocused();
  await expect(clientRow(page, 'Dune Logistics')).not.toContainText('Archived');
  await page.keyboard.press('Enter');
  await dialog.getByRole('button', { name: 'Archive' }).click();
  await expect(dialog).toBeHidden();
  await expect(clientRow(page, 'Dune Logistics')).toContainText('Archived');

  // Scenario: Archived clients are not offered for new jobs, and their existing jobs still show them.
  await page.goto('/app/jobs/new');
  await expect(page.getByLabel('Team or client').locator('option')).toHaveText(['Our team', 'Falcon Pay']);
  await page.goto('/app/jobs');
  await expect(jobRow.getByRole('cell').nth(1)).toHaveText('Dune Logistics');
});

for (const theme of themes)
  test(`Scenario: The pages are accessible (${theme})`, async ({ page, context, baseURL }) => {
    await context.addCookies([{ name: 'theme', value: theme, url: baseURL ?? '' }]);
    await signIn(page, { email: ZAID });
    await page.goto('/app/settings/clients');
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await expect(page.getByRole('heading', { level: 1, name: 'Clients' })).toBeVisible();
    await expectNoAxeViolations(page);
    await page.goto('/app/jobs/new');
    await expect(page.getByLabel('Team or client')).toBeVisible();
    await expectNoAxeViolations(page);
  });

test('Scenario: In-house workspaces have no clients', async ({ page }) => {
  await signIn(page, { email: 'alex@example.com' });
  await page.goto('/app/jobs/new');
  await expect(page.getByRole('textbox', { name: /^Team/ })).toBeVisible();
  await expect(page.getByLabel('Team or client')).toHaveCount(0);
  await page.goto('/app/settings');
  await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Clients' })).toHaveCount(0);
  // The settings loading boundary streams the page, so the not-found page arrives with status 200.
  await page.goto('/app/settings/clients');
  await expect(page.getByText('This page could not be found.')).toBeVisible();
});
