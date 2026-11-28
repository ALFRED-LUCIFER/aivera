import { expect, test, type Page } from '@playwright/test';
import { signIn } from './auth.ts';
import { expectAccessible, themes } from './gallery.ts';

// AIV-P1-009 J1 step 4, Add a job step 2: what the description leaves out. The fake model answers from recorded fixtures
// (tests/e2e/ai-fixtures.json, the eval set's senior-ai-engineer case). The suggestions per job type are the eval set's
// (packages/ai/evals/jobs.draftCompetencies), and the duplicate filter is a unit test (modules/jobs job.test.ts).

const DESCRIPTION =
  'You will ship and run LLM assistants and retrieval systems that real merchants use every day. You will build ' +
  'the eval sets and retrieval metrics that decide what we ship. You will write production Python services, with ' +
  'tests, and deploy them yourself. You keep latency, cost per request and incidents in check. ' +
  'The assistant answers merchants in Arabic and English.';

async function draft(page: Page, description: string) {
  await signIn(page, { email: 'mira@example.com' });
  await page.goto('/app/jobs/new');
  await page.getByLabel('Job type').selectOption({ label: 'AI and LLM engineering' });
  await page.getByLabel('Job title').fill('Senior AI Engineer');
  await page.getByLabel('Job description').fill(description);
  await page.getByRole('button', { name: 'Draft competencies' }).click();
}
const suggestions = (page: Page) => page.getByRole('table', { name: 'Suggested competencies' });
const rowOf = (page: Page, name: string) => suggestions(page).getByRole('row').filter({ hasText: name });

for (const theme of themes) {
  test(`Scenario: A suggestion explains itself, then remove and restore from the keyboard (${theme})`, async ({
    page,
    context,
    baseURL,
  }) => {
    await context.addCookies([{ name: 'theme', value: theme, url: baseURL ?? '' }]);
    await draft(page, DESCRIPTION);

    await expect(page.getByRole('heading', { name: 'Missing from your description · 2 suggestions' })).toBeVisible();
    const arabic = rowOf(page, 'Arabic and bilingual NLP');
    const cells = arabic.getByRole('cell');
    await expect(cells.nth(0)).toContainText('Suggested by Credalent');
    // AIV-P1-165: the reasoning, and the line it rests on, only behind "Why suggested?", opened from the keyboard.
    const why = arabic.getByText(
      'The assistant must answer in Arabic, but the description lists no language requirement.',
    );
    await expect(why).toBeHidden();
    await expect(arabic.locator('mark')).toBeHidden();
    await arabic.getByText('Why suggested?').focus();
    await page.keyboard.press('Enter');
    await expect(why).toBeVisible();
    await expect(cells.nth(0)).toContainText(
      'Evidence expected: Work on Arabic or bilingual text: models, evals, tokenisation',
    );
    await expect(cells.nth(1)).toHaveText('10%');
    await expect(cells.nth(2)).toHaveText('2 of 5');
    await expect(cells.nth(3)).toHaveText('Desirable');
    // Every AI statement cites the description: the line that implies the suggestion, in the shared highlight.
    await expect(arabic.locator('mark')).toHaveText(
      'cited from your description The assistant answers merchants in Arabic and English',
    );
    await expect(rowOf(page, 'Product judgement').getByRole('cell').nth(1)).toHaveText('15%');
    await expect(page.getByText('Weights total 100%')).toBeVisible();
    await expectAccessible(page);

    // Scenario: Remove and restore. One button toggles, so focus stays where the recruiter is.
    await page.getByRole('button', { name: 'Remove Product judgement' }).focus();
    await page.keyboard.press('Enter');
    await expect(rowOf(page, 'Product judgement')).toContainText('Product judgement removed from this rubric.');
    // Read out by the step's polite region, which is on the page before the removal.
    await expect(page.locator('output.sr-only')).toHaveText('Product judgement removed from this rubric.');
    const restore = page.getByRole('button', { name: 'Restore Product judgement' });
    await expect(restore).toBeFocused();
    // AIV-P1-165: the total is stated, as it is.
    await expect(page.getByText('Weights total 85%. They rebalance to 100% when you save.')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Missing from your description · 1 suggestion' })).toBeVisible();
    await expectAccessible(page);

    await page.keyboard.press('Enter');
    await expect(rowOf(page, 'Product judgement').getByRole('cell').nth(1)).toHaveText('15%');
    await expect(page.getByRole('button', { name: 'Remove Product judgement' })).toBeFocused();
    await expect(page.getByText('Weights total 100%')).toBeVisible();
  });
}

test('Scenario: No suggestions', async ({ page }) => {
  await draft(page, 'You will build the eval dashboards our team reads every morning.');
  await expect(page.getByRole('heading', { name: 'Missing from your description · 0 suggestions' })).toBeVisible();
  await expect(page.getByText('Nothing obvious is missing from your description.')).toBeVisible();
  await expect(suggestions(page)).toHaveCount(0);
});
