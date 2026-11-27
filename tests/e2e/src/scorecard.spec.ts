import type { Locator, Page } from '@playwright/test';
import { seededInterviewLabels } from '../gulfDay.ts';
import { signIn } from './auth.ts';
import { expect, test } from './csp.ts';
import { css, expectAccessible, themes } from './gallery.ts';

// AIV-P2-004, a step of J3: the interview scorecard. In AP's workspace "Demo" (seed.ts) Daniel Novak's Round 1 on
// Senior AI Engineer is in progress with AP as its interviewer, and tests "Retrieval and evaluation" (a CV claim) and
// "Cost and reliability" (an incident review he submitted), each with two stored suggested questions. The page calls
// no model: ai-fixtures.json has no answer for it.
const AP = 'ap@example.com';
const NOTE = 'Walked through the 200-question set he built';
const SCORE = '14 Nov · backed score 55';
const WAITS = 'Submitting needs the preview of your ratings, which is unavailable now.';

/** Opens Daniel's scorecard from the Interviews list. */
async function openScorecard(page: Page) {
  await page.goto('/app/interviews');
  await page.getByRole('row').filter({ hasText: 'Daniel Novak' }).getByRole('link', { name: 'Open scorecard' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Round 1 scorecard: Daniel Novak' })).toBeVisible();
}

const card = (page: Page, name: string) => page.getByRole('region', { name: new RegExp(`^${name}`) });
// The competency's name is a visually hidden span in the legend, which the browser's accessible name sets off with a space.
const rating = (page: Page, name: string) =>
  page.getByRole('radiogroup', { name: new RegExp(`^Your assessment ?: ${name}$`) });
// Playwright does not read a disabled fieldset with role="radiogroup" as disabled, so the state is checked on a radio.
const ratingRadio = (page: Page, name: string) => rating(page, name).getByRole('radio', { name: 'Not shown' });
const notAsked = (page: Page, number: number) =>
  card(page, 'Cost and reliability')
    .getByRole('group', { name: `Question ${number}` })
    .getByRole('button', { name: 'Not asked' });

/** Presses a mark by keyboard to the wanted state: a retry, or a local database an earlier run left, may hold it already. */
async function setMark(page: Page, button: Locator, pressed: boolean) {
  if ((await button.getAttribute('aria-pressed')) === String(pressed)) return;
  await button.focus();
  await page.keyboard.press('Space');
  await expect(button).toHaveAttribute('aria-pressed', String(pressed));
}

// The second test saves the draft the later ones read.
test.describe.configure({ mode: 'serial' });

test('Scenario: Scorecard shows what to test', async ({ page }) => {
  await signIn(page, { email: AP });
  await openScorecard(page);
  await expect(page).toHaveTitle('Interview scorecard · Credalent');
  // "Today, 14:00" on the seed's Gulf day, its date after Gulf midnight (AIV-P1-149).
  await expect(
    page.getByText(`Senior AI Engineer · structured screen · ${seededInterviewLabels().daniel} · interviewer: you`, {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: /^Interviews/ }),
  ).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('list', { name: 'Interview rounds' }).getByRole('listitem')).toHaveText([
    `Evidence assessed${SCORE}Observed`,
    'Round 1, structured screenCurrent round',
    'Round 2, evidence defenceIf shortlisted',
    'Round 3, panelIf shortlisted',
  ]);

  const retrieval = card(page, 'Retrieval and evaluation');
  await expect(retrieval.getByRole('heading', { level: 2 })).toHaveText('Retrieval and evaluation · weight 20%');
  await expect(retrieval.getByText('Supporting', { exact: true })).toBeVisible();
  await expect(retrieval.getByText('Claim awaiting validation', { exact: true })).toBeVisible();
  // A claim's words are shown plain, never highlighted (AGENTS.md 1.6).
  await expect(retrieval.getByText('raised answer accuracy from 71% to 88%', { exact: true })).toBeVisible();
  await expect(retrieval.locator('mark')).toHaveCount(0);
  await expect(retrieval.getByText('Claim only. Counts as zero in the backed score.')).toBeVisible();

  const cost = card(page, 'Cost and reliability');
  await expect(cost.getByRole('heading', { level: 2 })).toHaveText('Cost and reliability · weight 15%');
  await expect(cost.getByText('Medium', { exact: true })).toBeVisible();
  await expect(cost.getByText('Candidate-submitted', { exact: true })).toBeVisible();
  await expect(cost.getByRole('list', { name: 'Sources' })).toHaveText('Incident review, March (PDF)');
  // Inspected work is highlighted.
  await expect(cost.locator('mark')).toHaveText(
    'cited evidence rolled back the index change and restored search within the hour',
  );

  for (const name of ['Retrieval and evaluation', 'Cost and reliability']) {
    await expect(rating(page, name).getByRole('radio')).toHaveCount(4);
    for (const number of [1, 2])
      await expect(
        card(page, name)
          .getByRole('group', { name: `Question ${number}` })
          .getByRole('button'),
      ).toHaveText(['Not asked', 'Not answered']);
  }
  await expect(
    retrieval.getByText('How was the 71% measured, on which questions, and who built that set?'),
  ).toBeVisible();

  // No overall or AI judgement of the person: the only choices are a rating per competency and the recommendation.
  await expect(page.getByRole('radiogroup')).toHaveCount(3);
  // The "Meeting summary" panel (AIV-P1-115) is the interviewer's own pasted text, allowed on this page by the owner's
  // decision of 24 Nov 2026: only the word "summary" is allowed in it, and nowhere else on the page.
  const summaryPanel = page.getByRole('region', { name: 'Meeting summary' });
  await expect(summaryPanel).toBeVisible();
  await expect(summaryPanel).not.toContainText(/overall|communication|english|confidence|attitude|soft.skill/i);
  await summaryPanel.evaluate((panel) => panel.remove());
  await expect(page.getByRole('main')).not.toContainText(
    /overall|summary|communication|english|confidence|attitude|soft.skill/i,
  );
});

test('Scenario: Rate and note, and a competency that was not tested stays a gap: by keyboard, saved, and kept on reopening', async ({
  page,
}) => {
  await signIn(page, { email: AP });
  await openScorecard(page);

  // Rate "Retrieval and evaluation" with the arrow keys; the segment under the keyboard shows the focus ring.
  const retrieval = rating(page, 'Retrieval and evaluation');
  await retrieval.getByRole('radio', { name: 'Not shown' }).focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  const clearly = retrieval.getByRole('radio', { name: 'Clearly shown' });
  await expect(clearly).toBeChecked();
  await expect(clearly).toBeFocused();
  expect(await css(retrieval.locator('label').filter({ hasText: 'Clearly shown' }), 'outline-style')).toBe('solid');
  // Tab moves on to the note.
  await page.keyboard.press('Tab');
  const note = card(page, 'Retrieval and evaluation').getByLabel('What you saw or heard');
  await expect(note).toBeFocused();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type(NOTE);

  // Mark both questions of "Cost and reliability" as not asked. An earlier run (a retry, or a local database) saved both
  // marks in "Demo": open the second again first, so the first mark alone leaves the rating enabled.
  await setMark(page, notAsked(page, 2), false);
  await setMark(page, notAsked(page, 1), true);
  await expect(ratingRadio(page, 'Cost and reliability')).toBeEnabled();
  await setMark(page, notAsked(page, 2), true);
  await expect(ratingRadio(page, 'Cost and reliability')).toBeDisabled();
  await expect(card(page, 'Cost and reliability').getByText('Not assessed in this round · stays a gap')).toBeVisible();

  // A recommendation is not a decision.
  await page.getByRole('radio', { name: 'Recommend for the Round 2 shortlist' }).check();
  await expect(
    page.getByText('A recommendation, not a decision. The hiring owner decides in the decision pack.'),
  ).toBeVisible();

  const save = page.getByRole('button', { name: 'Save and close' });
  await save.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/app\/interviews$/);
  // Nothing moved: his interview is still in progress and still listed.
  await expect(page.getByRole('row').filter({ hasText: 'Daniel Novak' }).getByRole('cell').nth(4)).toHaveText(
    'In progress',
  );

  await openScorecard(page);
  await expect(rating(page, 'Retrieval and evaluation').getByRole('radio', { name: 'Clearly shown' })).toBeChecked();
  await expect(card(page, 'Retrieval and evaluation').getByLabel('What you saw or heard')).toHaveValue(NOTE);
  await expect(notAsked(page, 1)).toHaveAttribute('aria-pressed', 'true');
  await expect(notAsked(page, 2)).toHaveAttribute('aria-pressed', 'true');
  await expect(ratingRadio(page, 'Cost and reliability')).toBeDisabled();
  await expect(card(page, 'Cost and reliability').getByText('Not assessed in this round · stays a gap')).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Recommend for the Round 2 shortlist' })).toBeChecked();
  // Daniel's backed score is still 55, here and on the ranking; his stage is as it was.
  await expect(page.getByText(SCORE)).toBeVisible();
  await page.goto('/app/jobs');
  await page.getByRole('link', { name: 'Senior AI Engineer' }).click();
  const ranked = page
    .getByRole('table', { name: 'Ranked candidates' })
    .getByRole('row')
    .filter({ hasText: 'Daniel Novak' });
  // AIV-P2-007: the line under his name is his round, still under way: the scorecard draft changed nothing.
  await expect(ranked).toContainText('Daniel NovakRound 1 in progress55up to 78 if claims hold3 of 6Medium');
});

// The seeded scores are hand-written (seed.ts), so the assessment cannot preview a rating of Daniel's: it reads them as
// evidence not yet scored. "Submit needs every competency rated or marked" is submit-scorecard.spec.ts, on a workspace
// of its own whose scores the assessment computed; the seeded interview stays open for the tests after this one.
test('Scenario: Submit waits for a preview of the ratings, and says why', async ({ page }) => {
  await signIn(page, { email: AP });
  await openScorecard(page);
  const submit = page.getByRole('button', { name: 'Submit scorecard' });
  // No preview, no submit (AGENTS.md 1.5): what a submit applies is what was shown (AIV-P2-006).
  await expect(page.getByText(WAITS)).toBeVisible();
  await expect(submit).toBeDisabled();
  await expect(submit).toHaveAccessibleDescription(WAITS);
  await expect(page.getByText(SCORE)).toBeVisible();
});

test('Scenario: Only the assigned interviewer or an admin edits: a hiring owner on the job reads it and changes nothing', async ({
  page,
  context,
}) => {
  await signIn(page, { email: AP });
  await openScorecard(page);
  const { pathname } = new URL(page.url());
  await context.clearCookies({ name: '__Host-credalent-session' });
  // The Head of Engineering is the hiring owner of Senior AI Engineer in "Demo", granted the job, not its interviewer.
  await signIn(page, { email: 'head.engineering@example.com', name: 'Head of Engineering' });
  await page.goto(pathname);
  await expect(page.getByText(/^You can read this scorecard but not change it\./)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save and close' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Submit scorecard' })).toHaveCount(0);
  await expect(ratingRadio(page, 'Retrieval and evaluation')).toBeDisabled();
  // AP's draft is not theirs to read.
  await expect(
    rating(page, 'Retrieval and evaluation').getByRole('radio', { name: 'Clearly shown' }),
  ).not.toBeChecked();
  await expect(card(page, 'Retrieval and evaluation').getByLabel('What you saw or heard')).toHaveValue('');
});

for (const theme of themes) {
  test(`axe passes on the scorecard, with a competency open again and why Submit waits shown (${theme})`, async ({
    page,
    context,
    baseURL,
  }) => {
    await context.addCookies([{ name: 'theme', value: theme, url: baseURL ?? '' }]);
    await signIn(page, { email: AP });
    await openScorecard(page);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    // "Submit scorecard" waits, disabled, with the line that says why (AIV-P2-006).
    await expect(page.getByText(WAITS)).toBeVisible();
    await expectAccessible(page);
    await setMark(page, notAsked(page, 1), false);
    await expect(ratingRadio(page, 'Cost and reliability')).toBeEnabled();
    await expectAccessible(page);
    // Left as the earlier tests saved it.
    await setMark(page, notAsked(page, 1), true);
    await page.getByRole('button', { name: 'Save and close' }).click();
    await expect(page).toHaveURL(/\/app\/interviews$/);
  });
}
