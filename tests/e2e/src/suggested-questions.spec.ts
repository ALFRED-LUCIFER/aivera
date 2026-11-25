import type { Page } from '@playwright/test';
import { signIn } from './auth.ts';
import { expect, test } from './csp.ts';
import { expectAccessible, themes } from './gallery.ts';

// AIV-P1-113, a step of J2: "Needs live verification" on the candidate evidence profile. In AP's workspace "Demo"
// (seed.ts) Sara Al Qahtani has two gaps on Senior AI Engineer: "Product judgement", proven below the job's need by a
// submitted repository, and "Arabic and bilingual NLP", a claim from the Round 1 notes. The model is stubbed at the
// port: ai-fixtures.json answers the prompt that starts "Suggest interview questions for the gaps below." with two
// questions for each. Her other competencies are no gap, so nothing is suggested for them.
const AP = 'ap@example.com';
const FIT =
  "68 backed by evidence · up to 84 if their two open claims hold · meets the job's need on 4 of 6 competencies · rank 1 of 8";

/** Opens a candidate's profile from Senior AI Engineer's ranking by keyboard. */
async function openProfile(page: Page, name: string) {
  await page.goto('/app/jobs');
  await page.getByRole('link', { name: 'Senior AI Engineer' }).click();
  await expect(page).toHaveTitle('Senior AI Engineer: Evidence and ranking · Credalent');
  await page.getByRole('table', { name: 'Ranked candidates' }).getByRole('link', { name }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
}

const block = (page: Page) => page.getByRole('region', { name: 'Needs live verification' });

/** The suggested questions as the fixture gives them, each under its gap with its source and both notes. */
async function expectQuestions(page: Page) {
  const product = block(page).getByRole('region', { name: 'Product judgement' });
  await expect(product.getByRole('listitem')).toHaveCount(2);
  const first = product.getByRole('listitem').first();
  await expect(first).toContainText('How did the contract tests change a product decision, and which one?');
  // Inspected work is cited with its words highlighted and its source named.
  await expect(first.locator('mark')).toHaveText('cited evidence contract tests on every endpoint');
  await expect(first).toContainText('Source: code.credalent.example/…/fastapi-ml-serve');
  await expect(first).toContainText(
    'A strong answer shows: Names a decision the tests informed and what merchants saw.',
  );
  await expect(first).toContainText('A weak answer shows: Describes the tests but no decision they changed.');

  const arabic = block(page).getByRole('region', { name: 'Arabic and bilingual NLP' });
  await expect(arabic.getByRole('listitem')).toHaveCount(2);
  const claim = arabic.getByRole('listitem').first();
  await expect(claim).toContainText(
    'Walk me through the Gulf Arabic evaluation set, how it was built and what it changed.',
  );
  // A claim's words are quoted, never highlighted (AGENTS.md 1.6).
  await expect(claim.locator('q')).toHaveText('built a Gulf Arabic evaluation set');
  await expect(claim.locator('mark')).toHaveCount(0);
  await expect(claim).toContainText('Source: Round 1 notes, 14 Nov');
  await expect(claim).toContainText('A strong answer shows:');
  await expect(claim).toContainText('A weak answer shows:');

  // Only the gaps: nothing for a competency backed at the job's need.
  await expect(block(page).getByRole('region')).toHaveCount(2);
  await expect(block(page).getByRole('region', { name: 'LLM systems in production' })).toHaveCount(0);
  // Stored for this snapshot: nothing more to ask for.
  await expect(block(page).getByRole('button')).toHaveCount(0);
}

// The first test stores the questions the others read.
test.describe.configure({ mode: 'serial' });

test('Scenario: Questions for each gap, each cited: asked by keyboard, and her score, stage and rank are unchanged', async ({
  page,
}) => {
  await signIn(page, { email: AP });
  await openProfile(page, 'Sara Al Qahtani');
  await expect(block(page).getByRole('heading', { level: 2, name: 'Needs live verification' })).toBeVisible();
  await expect(block(page).getByText('they change no score, stage or rank')).toBeVisible();
  const suggest = block(page).getByRole('button', { name: 'Suggest interview questions' });
  // A retry, or a local database an earlier run left, already holds the stored set: it is shown with no button, and
  // every assertion below holds for it as well.
  if (await suggest.isVisible()) {
    await suggest.focus();
    await page.keyboard.press('Enter');
  }
  await expectQuestions(page);
  // Guidance only (AGENTS.md 1.5): the fit line, with her score and rank, and her stage read as before.
  await expect(page.getByText(FIT, { exact: true })).toBeVisible();
  await expect(page.getByText('Senior AI Engineer · New', { exact: true })).toBeVisible();
});

for (const theme of themes) {
  test(`Scenario: Questions are kept for the snapshot they were made from: shown again with no request, axe passes (${theme})`, async ({
    page,
    context,
    baseURL,
  }) => {
    await context.addCookies([{ name: 'theme', value: theme, url: baseURL ?? '' }]);
    await signIn(page, { email: AP });
    await openProfile(page, 'Sara Al Qahtani');
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await expectQuestions(page);
    await expectAccessible(page);
  });
}

test('a hiring owner granted the job reads the stored questions', async ({ page, context }) => {
  await signIn(page, { email: AP });
  await openProfile(page, 'Sara Al Qahtani');
  const sara = new URL(page.url());
  await context.clearCookies({ name: '__Host-credalent-session' });
  // The Head of Engineering is the hiring owner of Senior AI Engineer in "Demo", granted the job (seed.ts).
  await signIn(page, { email: 'head.engineering@example.com' });
  await page.goto(sara.pathname + sara.search);
  await expectQuestions(page);
});
