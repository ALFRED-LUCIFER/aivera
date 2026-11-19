import { expect, test, type Page } from '@playwright/test';
import { signIn } from './auth.ts';
import { expectNoAxeViolations, themes } from './gallery.ts';

// AIV-P1-008 J1 step 4, Add a job step 2: Draft competencies. The model is the fake, answering from recorded fixtures
// (tests/e2e/ai-fixtures.json, the eval set's senior-ai-engineer case) by description text. Mira's "Draft Studio" and
// Karim's "Spent Budget Co" (seed.ts) are spent on by these tests only. "No candidate data reaches the prompt" and the
// citation contract's rejection of an uncited answer are unit tests (modules/jobs draft-competencies.test.ts).

const DESCRIPTION =
  'You will ship and run LLM assistants and retrieval systems that real merchants use every day. You will build ' +
  'the eval sets and retrieval metrics that decide what we ship. You will write production Python services, with ' +
  'tests, and deploy them yourself. You keep latency, cost per request and incidents in check. ' +
  'The assistant answers merchants in Arabic and English.';
const FAILING = 'You will keep our flaky assistants running.';

async function fill(page: Page, title: string, description: string, email = 'mira@example.com') {
  await signIn(page, { email });
  await page.goto('/app/jobs/new');
  await page.getByLabel('Job type').selectOption({ label: 'AI and LLM engineering' });
  await page.getByLabel('Job title').fill(title);
  await page.getByLabel('Job description').fill(description);
}
const draftButton = (page: Page) => page.getByRole('button', { name: 'Draft competencies' });
const table = (page: Page) => page.getByRole('table', { name: 'Drafted competencies' });
const rowOf = (page: Page, name: string) => table(page).getByRole('row').filter({ hasText: name });

for (const theme of themes) {
  test(`Scenario: Drafting the Senior AI Engineer description, cited, from the keyboard (${theme})`, async ({
    page,
    context,
    baseURL,
  }) => {
    await context.addCookies([{ name: 'theme', value: theme, url: baseURL ?? '' }]);
    await fill(page, 'Senior AI Engineer', DESCRIPTION);
    await draftButton(page).focus();
    await page.keyboard.press('Enter');

    await expect(page.getByRole('heading', { name: 'From your job description · 4 competencies' })).toBeVisible();
    await expect(page.getByText('2. Competencies, drafted and suggested')).toHaveAttribute('aria-current', 'step');
    const rows = [
      [
        'LLM systems in production',
        'A shipped assistant or RAG system with real users, and their part in it',
        '25%',
        '4 of 5',
        'Mandatory',
        'ship and run LLM assistants and retrieval systems that real merchants use every day',
      ],
      [
        'Retrieval and evaluation',
        'Eval sets and retrieval metrics, and how they changed decisions',
        '20%',
        '4 of 5',
        'Mandatory',
        'build the eval sets and retrieval metrics that decide what we ship',
      ],
      [
        'Python service engineering',
        'Production Python they wrote: services, tests, deployment',
        '15%',
        '3 of 5',
        'Mandatory',
        'write production Python services, with tests, and deploy them yourself',
      ],
      [
        'Cost and reliability',
        'Numbers on latency, cost per request and incidents handled',
        '15%',
        '2 of 5',
        'Desirable',
        'You keep latency, cost per request and incidents in check',
      ],
    ] as const;
    for (const [name, evidence, weight, level, type, quote] of rows) {
      const row = rowOf(page, name);
      await expect(row.getByRole('cell').nth(0)).toContainText(evidence);
      await expect(row.getByRole('cell').nth(1)).toHaveText(weight);
      await expect(row.getByRole('cell').nth(2)).toHaveText(level);
      await expect(row.getByRole('cell').nth(3)).toHaveText(type);
      // Scenario: Every drafted competency cites the description: its sentence, the quote in the shared highlight.
      await expect(row.getByText('From your description:')).toBeVisible();
      await expect(row.locator('mark')).toHaveText(`cited from your description ${quote}`);
    }
    await expect(
      page.getByRole('term').filter({ hasText: 'Evidence that counts for this job type' }).locator('+ dd'),
    ).toHaveText('Eval harnesses, prompt libraries, shipped assistants');
    await expectNoAxeViolations(page);

    // Keep, edit and remove, by keyboard. Nothing is applied beyond this page.
    await rowOf(page, 'Cost and reliability').getByRole('button', { name: 'Edit Cost and reliability' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByLabel('Competency name, Cost and reliability')).toBeFocused();
    await page.getByLabel('Level the job needs, Cost and reliability').selectOption({ label: '3 of 5' });
    await page.getByLabel('Type, Cost and reliability').selectOption({ label: 'Mandatory' });
    await expectNoAxeViolations(page);
    // In edit mode the row holds inputs, not text: its one Done button.
    await table(page).getByRole('button', { name: 'Done' }).click();
    await expect(rowOf(page, 'Cost and reliability').getByRole('cell').nth(2)).toHaveText('3 of 5');
    await expect(rowOf(page, 'Cost and reliability').getByRole('cell').nth(3)).toHaveText('Mandatory');

    await rowOf(page, 'Python service engineering')
      .getByRole('button', { name: 'Remove Python service engineering' })
      .focus();
    await page.keyboard.press('Enter');
    // Removed from the rubric, kept on the page to restore (AIV-P1-009); the heading counts the three kept.
    await expect(rowOf(page, 'Python service engineering')).toContainText(
      'Python service engineering removed from this rubric.',
    );
    await expect(page.getByRole('button', { name: 'Restore Python service engineering' })).toBeFocused();
    await expect(page.getByRole('heading', { name: 'From your job description · 3 competencies' })).toBeVisible();
  });
}

test('Scenario: Before drafting', async ({ page }) => {
  await fill(page, 'Senior AI Engineer', DESCRIPTION);
  await expect(
    page.getByText(
      'Choose Draft competencies. Aivera reads the description for a Senior AI Engineer, drafts the competencies it ' +
        'states, and suggests the ones it leaves out, such as knowledge of your industry or market.',
    ),
  ).toBeVisible();
  await expect(table(page)).toHaveCount(0);
});

// Once, not per theme: each run is three failed attempts, and five in a row open the client's circuit breaker for every
// other test on this server. Dark mode's alert is checked by the budget test.
test('Scenario: Drafting in progress, then the AI service fails', async ({ page }) => {
  await fill(page, 'Flaky AI Engineer', FAILING);
  await draftButton(page).click();
  // The fake fails every attempt, and the client retries with back-off: well over a second.
  const busy = page.getByRole('button', { name: 'Drafting competencies…' });
  await expect(busy).toBeDisabled();
  await expect(page.getByRole('alert').filter({ hasText: 'Aivera could not draft' })).toHaveText(
    'Aivera could not draft competencies. You can try again or add them yourself.',
    { timeout: 20_000 },
  );
  await expect(draftButton(page)).toBeEnabled();
  await expectNoAxeViolations(page);

  // The recruiter writes competencies by hand, or starts from the job type's starters.
  await page.getByRole('button', { name: 'Add competency' }).click();
  await expect(page.getByLabel('Competency name, New competency')).toBeFocused();
  await page.keyboard.type('Assistant operations');
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(rowOf(page, 'Assistant operations')).toBeVisible();
  await page.getByRole('button', { name: 'Remove Assistant operations' }).click();
  await page.getByRole('button', { name: 'Use the starter competencies' }).click();
  await expect(rowOf(page, 'Retrieval and evaluation').getByRole('cell').nth(1)).toHaveText('25%');
});

for (const theme of themes) {
  test(`The daily AI budget is used: a clear state, and competencies by hand (${theme})`, async ({
    page,
    context,
    baseURL,
  }) => {
    await context.addCookies([{ name: 'theme', value: theme, url: baseURL ?? '' }]);
    await fill(page, 'Senior AI Engineer', DESCRIPTION, 'karim@example.com');
    await draftButton(page).click();
    await expect(page.getByRole('alert').filter({ hasText: 'AI allowance' })).toHaveText(
      "This workspace has used today's AI allowance. You can add competencies yourself, or draft them tomorrow.",
    );
    await expect(page.getByRole('button', { name: 'Add competency' })).toBeVisible();
    await expectNoAxeViolations(page);
  });
}

test('Scenario: Nothing is saved by drafting', async ({ page }) => {
  await fill(page, 'Unsaved Draft Engineer', DESCRIPTION);
  // Enter in a field drafts (Draft is the form's default button); it never saves the job.
  await page.getByLabel('Job title').press('Enter');
  await expect(page).toHaveURL(/\/app\/jobs\/new$/);
  await expect(page.getByRole('heading', { name: 'From your job description · 4 competencies' })).toBeVisible();
  await page.goto('/app/jobs');
  await expect(page.getByRole('heading', { level: 1, name: 'Jobs' })).toBeVisible();
  await expect(page.getByText('Unsaved Draft Engineer')).toHaveCount(0);
});
