import { expect, test, type Page } from '@playwright/test';
import { signIn } from './auth.ts';
import { expectAccessible, themes } from './gallery.ts';

// AIV-P1-012: AP's workspace "Demo" (seed.ts): Senior AI Engineer has version 2 approved by the Head of Engineering on
// 12 Nov 2026, superseding version 1. The Head of Engineering is its granted hiring owner.
const AP = 'ap@example.com';

/** Opens the Senior AI Engineer rubric from the Jobs list and returns its URL. */
async function openRubric(page: Page) {
  await page.goto('/app/jobs');
  await page.getByRole('link', { name: 'Senior AI Engineer' }).click();
  await page.getByRole('link', { name: /^Competencies and rubric/ }).click();
  await expect(page).toHaveURL(/\/rubric$/);
  return page.url();
}

const table = (page: Page) => page.getByRole('table', { name: 'Agreed competencies' });

test('Scenario: Approved rubric version 2', async ({ page }) => {
  await signIn(page, { email: AP });
  await openRubric(page);
  const rows = table(page).getByRole('row');
  // The header row, then the six competencies.
  await expect(rows).toHaveCount(7);
  await expect(
    table(page)
      .getByRole('cell')
      .filter({ hasText: /^\d+%$/ }),
  ).toHaveText(['25%', '20%', '15%', '15%', '10%', '15%']);
  await expect(page.getByText('Weights total 100%')).toBeVisible();
  for (const name of ['Arabic and bilingual NLP', 'Product judgement'])
    await expect(rows.filter({ hasText: name })).toContainText('Suggested by Credalent, accepted');
  await expect(rows.filter({ hasText: 'LLM systems in production' })).not.toContainText('Suggested by Credalent');
  await expect(rows.filter({ hasText: 'Cost and reliability' })).toContainText('2 of 5Desirable');
});

test('Scenario: Scoring definitions say claims count zero', async ({ page }) => {
  await signIn(page, { email: AP });
  await openRubric(page);
  await expect(page.getByRole('definition').last()).toHaveText('Stated, with nothing to inspect. Counts as zero.');
  await expect(page.getByRole('term').last()).toHaveText('Claim only');
});

test('Scenario: Approval history and what success means', async ({ page }) => {
  await signIn(page, { email: AP });
  await openRubric(page);
  const history = page.getByRole('listitem').filter({ hasText: /^Version \d/ });
  await expect(history).toHaveText([
    'Version 2, approved · Head of Engineering · 12 Nov 2026',
    'Version 1, replaced by a newer version · Product judgement raised from 10% to 15%; Arabic NLP changed to desirable.',
  ]);
  await expect(page.getByText('Editing a weight creates a new version that needs approval again.')).toBeVisible();
  await expect(
    page.getByText(
      'Within six months, a bilingual assistant that answers merchant questions in English and Arabic is live, ' +
        'measured against an evaluation set, and running within an agreed cost per request.',
    ),
  ).toBeVisible();
});

test('Scenario: Hiring owner can read; an interviewer not on this job gets 403', async ({ page, context }) => {
  await signIn(page, { email: AP });
  const url = await openRubric(page);
  await context.clearCookies({ name: '__Host-credalent-session' });
  await signIn(page, { email: 'head.engineering@example.com', name: 'Head of Engineering' });
  await page.goto(url);
  await expect(page.getByText('Weights total 100%')).toBeVisible();
  await context.clearCookies({ name: '__Host-credalent-session' });
  await signIn(page, { email: 'rami@example.com' });
  expect((await page.goto(url))?.status()).toBe(403);
});

for (const theme of themes) {
  test(`axe passes on the rubric (${theme})`, async ({ page, context, baseURL }) => {
    await context.addCookies([{ name: 'theme', value: theme, url: baseURL ?? '' }]);
    await signIn(page, { email: AP });
    await openRubric(page);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await expect(page.getByText('Weights total 100%')).toBeVisible();
    await expectAccessible(page);
  });
}
