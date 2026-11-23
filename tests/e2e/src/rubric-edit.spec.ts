import { expect, test, type Page } from '@playwright/test';
import { signIn } from './auth.ts';
import { expectAccessible, themes } from './gallery.ts';

// AIV-P1-013: Alex's "Demo Hiring Co" (seed.ts) has "Applied AI Engineer" with the Rubric artboard's rubric: version 2
// approved by the Head of Engineering. The journey below runs once per seeded workspace, so it is one test.

async function openRubric(page: Page) {
  await page.goto('/app/jobs');
  await page.getByRole('link', { name: 'Applied AI Engineer' }).click();
  await page.getByRole('link', { name: /^Competencies and rubric/ }).click();
  await expect(page).toHaveTitle('Applied AI Engineer: Competencies and rubric · Credalent');
}

const weight = (page: Page, name: string) => page.getByRole('spinbutton', { name: `Weight for ${name}` });
const send = (page: Page) => page.getByRole('button', { name: 'Send changes for approval' });
const history = (page: Page) => page.getByRole('listitem').filter({ hasText: /^Version \d/ });
const NOTE = 'Cost and reliability raised from 15% to 20%; Product judgement lowered from 15% to 10%.';

test('Scenarios: edit as version 3, weights must total 100, send for approval, resume, concurrent edit', async ({
  page,
  context,
}) => {
  await signIn(page);
  await openRubric(page);
  await page.getByRole('button', { name: 'Edit rubric' }).click();

  // Weights must total 100 before sending.
  await weight(page, 'Product judgement').fill('10');
  await expect(page.getByText('Weights total 95%. They must total 100%.')).toBeVisible();
  await expect(send(page)).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Save draft' })).toBeDisabled();

  // Editing creates a draft version 3 with its change note.
  await weight(page, 'Cost and reliability').fill('20');
  await expect(page.getByText('Weights total 100%')).toBeVisible();
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Draft saved.' })).toBeVisible();
  await expect(history(page).first()).toHaveText(`Version 3, draft · ${NOTE}`);

  // Sending for approval keeps version 2 in force.
  await send(page).click();
  await expect(page.getByRole('status').filter({ hasText: 'Sent to Head of Engineering.' })).toHaveText(
    'Sent to Head of Engineering. The approved rubric still applies, and rankings do not change until the new ' +
      'version is approved.',
  );
  await expect(history(page)).toHaveText([
    `Version 3, awaiting approval · ${NOTE}`,
    'Version 2, approved · Head of Engineering · 12 Nov 2026',
    'Version 1, superseded · Product judgement raised from 10% to 15%; Arabic NLP changed to desirable.',
  ]);
  // The table shows the version in force, still 15% for Cost and reliability.
  await expect(page.getByRole('row').filter({ hasText: 'Cost and reliability' })).toContainText('15%');
  await expect(page.getByRole('link', { name: /^Competencies and rubric/ })).toContainText('Approved, version 2');

  // One open draft per job: editing again resumes version 3.
  await page.getByRole('button', { name: 'Edit rubric' }).click();
  await expect(weight(page, 'Cost and reliability')).toHaveValue('20');

  // Concurrent edit is detected: a second tab opened version 3 before this save.
  const other = await context.newPage();
  await openRubric(other);
  await other.getByRole('button', { name: 'Edit rubric' }).click();
  await weight(page, 'Retrieval and evaluation').fill('15');
  await weight(page, 'LLM systems in production').fill('30');
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Draft saved.' })).toBeVisible();
  await weight(other, 'Python service engineering').fill('20');
  await weight(other, 'LLM systems in production').fill('20');
  await other.getByRole('button', { name: 'Save draft' }).click();
  await expect(other.getByRole('alert').filter({ hasText: 'changed since' })).toHaveText(
    'This rubric changed since you opened it. Reload to see the latest.',
  );
  // Nothing was overwritten: version 3 holds the first tab's weights.
  await other.reload();
  await other.getByRole('button', { name: 'Edit rubric' }).click();
  await expect(weight(other, 'LLM systems in production')).toHaveValue('30');
});

test('Add and remove a competency, by keyboard', async ({ page }) => {
  await signIn(page);
  await openRubric(page);
  await page.getByRole('button', { name: 'Edit rubric' }).click();
  await page.getByRole('button', { name: 'Add competency' }).press('Enter');
  const name = page.getByRole('textbox', { name: /^Name of competency \d+$/ });
  await expect(name).toBeVisible();
  await name.fill('Prompt security');
  await expect(page.getByRole('button', { name: 'Remove Prompt security' })).toBeVisible();
  await page.getByRole('button', { name: 'Remove Prompt security' }).press('Enter');
  await expect(name).toHaveCount(0);
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('button', { name: 'Edit rubric' })).toBeVisible();
});

// AIV-P2-064: the save's server action never reaches the server, so the browser's fetch rejects.
for (const theme of themes) {
  test(`Scenario: A rejected save keeps the form, by keyboard, axe clean (${theme})`, async ({
    page,
    context,
    baseURL,
  }) => {
    await context.addCookies([{ name: 'theme', value: theme, url: baseURL ?? '' }]);
    await signIn(page);
    await openRubric(page);
    await page.getByRole('button', { name: 'Edit rubric' }).click();
    await weight(page, 'Product judgement').fill('10');
    await weight(page, 'Cost and reliability').fill('20');
    await page.route('**/*', (route) =>
      route.request().method() === 'POST' && route.request().headers()['next-action']
        ? route.abort()
        : route.fallback(),
    );
    await page.getByRole('button', { name: 'Save draft' }).press('Enter');
    await expect(page.getByRole('alert').filter({ hasText: 'We could not' })).toHaveText(
      'We could not save your changes. Try again.',
    );
    await expect(weight(page, 'Cost and reliability')).toHaveValue('20');
    await expect(page.getByRole('button', { name: 'Save draft' })).toBeEnabled();
    await expectAccessible(page);
  });
}

for (const theme of themes) {
  test(`axe passes on the rubric in edit mode (${theme})`, async ({ page, context, baseURL }) => {
    await context.addCookies([{ name: 'theme', value: theme, url: baseURL ?? '' }]);
    await signIn(page);
    await openRubric(page);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await page.getByRole('button', { name: 'Edit rubric' }).click();
    await expect(send(page)).toBeVisible();
    await expectAccessible(page);
  });
}
