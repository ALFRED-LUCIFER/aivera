import { expect, test, type Page } from '@playwright/test';
import { signIn } from './auth.ts';
import { expectAccessible, primaryButtons, themes } from './gallery.ts';

// AIV-P1-010 J1 step 5, Add a job step 3: save the job with rubric version 1 as a draft. The fake model answers from
// tests/e2e/ai-fixtures.json (the eval set's senior-ai-engineer case: 6 competencies totalling 100%). What is stored
// (weights rebalanced to exactly 100, level and type, origin, one transaction) is tests/integration jobs.test.ts.

const DESCRIPTION =
  'You will ship and run LLM assistants and retrieval systems that real merchants use every day. You will build ' +
  'the eval sets and retrieval metrics that decide what we ship. You will write production Python services, with ' +
  'tests, and deploy them yourself. You keep latency, cost per request and incidents in check. ' +
  'The assistant answers merchants in Arabic and English.';

async function draft(page: Page, title: string) {
  await signIn(page, { email: 'mira@example.com' });
  await page.goto('/app/jobs/new');
  await page.getByLabel('Job type').selectOption({ label: 'AI and LLM engineering' });
  await page.getByLabel('Job title').fill(title);
  await page.getByLabel('Job description').fill(DESCRIPTION);
  await page.getByRole('button', { name: 'Draft competencies' }).click();
  await expect(page.getByRole('heading', { name: 'Missing from your description · 2 suggestions' })).toBeVisible();
}
const save = (page: Page) => page.getByRole('button', { name: 'Save job and rubric' });
const SAVED =
  "Job saved. These competencies are now version 1 of this job's own rubric, marked as a draft. Other jobs keep " +
  'their own rubrics.';
const jobsRow = (page: Page, title: string) =>
  page.getByRole('row').filter({ has: page.getByRole('link', { name: title }) });

for (const theme of themes) {
  test(`Scenario: Save with weights totalling 100, after editing a level and type, from the keyboard (${theme})`, async ({
    page,
    context,
    baseURL,
  }) => {
    await context.addCookies([{ name: 'theme', value: theme, url: baseURL ?? '' }]);
    const title = `Saved AI Engineer ${theme} ${Date.now()}`;
    await draft(page, title);
    await expect(page.getByText('Weights total 100%')).toBeVisible();

    // Scenario: Edit a level and type.
    await page.getByRole('button', { name: 'Edit Cost and reliability' }).focus();
    await page.keyboard.press('Enter');
    await page.getByLabel('Level the job needs, Cost and reliability').selectOption({ label: '3 of 5' });
    await page.getByLabel('Type, Cost and reliability').selectOption({ label: 'Mandatory' });
    await page.getByRole('button', { name: 'Done' }).click();
    await expectAccessible(page);

    await save(page).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByText(SAVED)).toBeFocused();
    await expect(
      page.getByText('Next: approve the rubric on its page. Candidates are assessed only after that.'),
    ).toBeVisible();
    // AIV-P1-165 Scenario: The saved page leads to the rubric: titled "Job saved", with one primary button.
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Job saved');
    await expect(primaryButtons(page)).toHaveText(['Review and approve the rubric']);
    await expect(page.getByRole('link', { name: 'Review and approve the rubric' })).toHaveAttribute(
      'href',
      /^\/app\/jobs\/[0-9a-f-]+\/rubric$/,
    );
    await expectAccessible(page);

    // Scenario: Nothing is assessed from a draft.
    await page.getByRole('link', { name: 'Back to Jobs' }).click();
    await expect(page).toHaveURL(/\/app\/jobs$/);
    await expect(jobsRow(page, title)).toContainText('Draft, needs approval');
  });
}

test('Scenario: Weights rebalance when a suggestion was removed', async ({ page }) => {
  await draft(page, 'Rebalanced AI Engineer');
  await page.getByRole('button', { name: 'Remove Product judgement' }).click();
  await expect(page.getByText('Weights total 85%. They rebalance to 100% when you save.')).toBeVisible();
  await save(page).click();
  await expect(page.getByText(SAVED)).toBeVisible();
});

test('Scenario: Validation: a competency with no name blocks saving and nothing is stored', async ({ page }) => {
  await draft(page, 'Nameless AI Engineer');
  await page.getByRole('button', { name: 'Add competency' }).click();
  await page.getByRole('button', { name: 'Done' }).click();
  await save(page).click();
  // The row opens to fix, with the field error.
  const name = page.getByLabel('Competency name, New competency');
  await expect(name).toBeFocused();
  await expect(name).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByText('Every competency needs a name.')).toBeVisible();
  await expect(page.getByText(SAVED)).toHaveCount(0);
  await expectAccessible(page);

  await page.goto('/app/jobs');
  await expect(page.getByRole('heading', { level: 1, name: 'Jobs' })).toBeVisible();
  await expect(page.getByText('Nameless AI Engineer')).toHaveCount(0);
});

test('Scenario: Save fails: the edits stay and nothing is half-saved', async ({ page }) => {
  await draft(page, 'Refused AI Engineer');
  // The server refuses a rubric the page would never send, as it would any failed save.
  await page.locator('input[name="rubric"]').evaluate((input: HTMLInputElement) => (input.value = 'not json'));
  await save(page).click();
  await expect(page.getByRole('alert').filter({ hasText: 'could not save' })).toHaveText(
    'We could not save the job. Your edits are still here.',
  );
  await expect(page.getByLabel('Job title')).toHaveValue('Refused AI Engineer');
  await expect(page.getByRole('table', { name: 'Suggested competencies' })).toContainText('Arabic and bilingual NLP');

  await page.goto('/app/jobs');
  await expect(page.getByRole('heading', { level: 1, name: 'Jobs' })).toBeVisible();
  await expect(page.getByText('Refused AI Engineer')).toHaveCount(0);
});

test('Scenario: Discard draft', async ({ page }) => {
  await draft(page, 'Discarded AI Engineer');
  await page.getByRole('button', { name: 'Discard draft' }).click();
  await page
    .getByRole('dialog', { name: 'Discard this job?' })
    .getByRole('button', { name: 'Discard', exact: true })
    .click();
  await expect(page).toHaveURL(/\/app\/jobs$/);
  await expect(page.getByText('Discarded AI Engineer')).toHaveCount(0);
});
