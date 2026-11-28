import { type Page } from '@playwright/test';
import { signIn } from './auth.ts';
import { expect, test } from './csp.ts';
import { css, expectAccessible, themes } from './gallery.ts';

// AIV-P1-047, the J2 step: compare the candidates ticked on the ranking, side by side, with the trade-offs. In AP's
// workspace "Demo" (seed.ts) Sara Al Qahtani (68 up to 84), Arjun Menon (64 up to 76) and Layla Haddad (61 up to 82,
// the candidate the canvas calls Huda) are scored on Senior AI Engineer, each with a competency a checked repository
// proves. The model is stubbed at the port: ai-fixtures.json answers the trio's trade-offs prompt, and fails the
// prompt for Arjun and Layla alone with a 503.
const AP = 'ap@example.com';

/** Ticks the named candidates on Senior AI Engineer's ranking and opens their comparison from the bulk bar. */
async function compare(page: Page, names: string[]) {
  await signIn(page, { email: AP });
  await page.goto('/app/jobs');
  await page.getByRole('link', { name: 'Senior AI Engineer' }).click();
  await expect(page).toHaveTitle('Senior AI Engineer: Evidence and ranking · Credalent');
  const table = page.getByRole('table', { name: 'Ranked candidates' });
  // A click before the page hydrates is lost; check() does nothing once the box is ticked, so it is safe to repeat.
  for (const name of names)
    await expect(() => table.getByRole('checkbox', { name: `Select ${name}` }).check({ timeout: 1000 })).toPass();
  await page.getByRole('region', { name: 'Bulk actions' }).getByRole('button', { name: 'Compare' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Compare candidates' })).toBeVisible();
}
const grid = (page: Page) => page.getByRole('table', { name: 'Candidates compared by competency' });
const tradeoffs = (page: Page) => page.getByRole('region', { name: 'The trade-offs' });
const TRIO = ['Sara Al Qahtani', 'Arjun Menon', 'Layla Haddad'];

test('Scenario: Three candidates', async ({ page }) => {
  await compare(page, TRIO);
  await expect(page).toHaveTitle('Compare candidates · Credalent');
  await expect(page.getByText(/^Senior AI Engineer · rubric v2\. The same 6 competencies, side by side/)).toBeVisible();
  await expect(grid(page).getByRole('columnheader')).toHaveText([
    'Competency',
    // Her Arabic rests on what she said in Round 1: said once for the column, in neutral ink (AIV-P1-165 §10).
    'Sara Al Qahtani68up to 84 if claims holdTo check in interview',
    'Arjun Menon64up to 76 if claims hold',
    'Layla Haddad61up to 82 if claims hold',
  ]);
  // Heaviest competency first, each with its weight and the level the job needs.
  await expect(grid(page).getByRole('rowheader').first()).toHaveText(
    'LLM systems in productionWeight 25% · job needs 4 of 5',
  );
  const arabic = grid(page).getByRole('row', { name: /^Arabic and bilingual NLP/ });
  await expect(arabic.getByRole('rowheader')).toHaveText('Arabic and bilingual NLPWeight 10% · job needs 2 of 5');
  await expect(arabic.getByRole('cell').nth(2)).toHaveText(
    'StrongAbove the need · 5 against 2Independently corroboratedarabic-ocr: public and documented, with most commits their own.',
  );
  // Sara's Arabic rests on a claim only: the quoted line first, then one status line with the strength her profile
  // shows for it ("Claim only" is how this note is stored) and that it counts 0 (AGENTS.md 1.6, AIV-P1-165 §10).
  await expect(arabic.getByRole('cell').first()).toHaveText(
    '“States they built a Gulf Arabic evaluation set. Nothing to inspect yet.”Claim onlyClaim. Counts 0 against 2.',
  );
  // "Change selection" goes back to the ranking with the same three still ticked.
  await page.getByRole('link', { name: 'Change selection' }).click();
  await expect(page.getByRole('region', { name: 'Bulk actions' }).getByRole('status')).toHaveText('3 selected');
});

test('Scenario: Trade-offs cite evidence, asked for by keyboard', async ({ page }) => {
  await compare(page, TRIO);
  // Nothing is shown, and no model is asked, until a person asks.
  await expect(tradeoffs(page).getByRole('listitem')).toHaveCount(0);
  await tradeoffs(page).getByRole('button', { name: 'Show the trade-offs' }).focus();
  await page.keyboard.press('Enter');
  const layla = tradeoffs(page).getByRole('list', { name: 'Layla Haddad' }).getByRole('listitem');
  // The model only picks: the fixture quotes part of the line and part of the excerpt, and each is shown whole.
  await expect(layla).toHaveText([
    'Layla Haddad is the only one compared with independently checked work on Arabic and bilingual NLP.',
    /^Cited evidence for Layla Haddad:.*arabic-ocr: public and documented, with most commits their own\.Source: /,
  ]);
  await expect(layla.first().getByRole('link', { name: 'Layla Haddad' })).toHaveAttribute(
    'href',
    /^\/app\/candidates\/[0-9a-f-]{36}\?job=[0-9a-f-]{36}$/,
  );
  // Cited work is highlighted with its source and links to that item on the candidate's profile.
  const work = tradeoffs(page).getByRole('list', { name: 'Sara Al Qahtani' }).getByRole('listitem').nth(1);
  await expect(work).toContainText('Cited evidence for Sara Al Qahtani:');
  await expect(work.locator('mark')).toHaveText('cited evidence authored 412 of 460 commits');
  await expect(work).toContainText('Source: llm-eval-harness');
  await expect(tradeoffs(page)).toContainText(
    '7 points separate the 3 candidates. The open claims are large enough to change this order.',
  );
  await work.getByRole('link').click();
  await expect(page.getByRole('heading', { level: 1, name: 'Sara Al Qahtani' })).toBeVisible();
  expect(new URL(page.url()).hash).toMatch(/^#evidence-[0-9a-f-]{36}$/);
});

test('Scenario: Trade-offs unavailable', async ({ page }) => {
  await compare(page, ['Arjun Menon', 'Layla Haddad']);
  await tradeoffs(page).getByRole('button', { name: 'Show the trade-offs' }).click();
  await expect(tradeoffs(page)).toContainText('Trade-off summary unavailable. The grid above is complete.', {
    timeout: 30_000,
  });
  await expect(grid(page).getByRole('columnheader')).toHaveCount(3);
  await expect(tradeoffs(page).getByRole('button', { name: 'Try again' })).toBeEnabled();
});

test('Scenario: One candidate, and candidates from another job', async ({ page }) => {
  await compare(page, ['Sara Al Qahtani', 'Arjun Menon']);
  const url = new URL(page.url());
  const [sara] = (url.searchParams.get('ids') ?? '').split(',');
  await page.goto(`${url.pathname}?ids=${sara}`);
  await expect(page.getByText('Choose 2 to 10 candidates to compare')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Change selection' })).toBeVisible();
  await expect(page.getByRole('table')).toHaveCount(0);
  // An id that is no applicant of this job (another job's applicant takes the same path: the only test is this job's
  // applicant list): no comparison, and nothing about anyone.
  await page.goto(`${url.pathname}?ids=${sara},0190d4a2-0000-7000-8000-00000000c0ff`);
  await expect(page.getByText('These candidates are not all on this job')).toBeVisible();
  await expect(page.getByRole('table')).toHaveCount(0);
  expect(await page.content()).not.toContain('Sara Al Qahtani');
});

for (const theme of themes) {
  test(`axe passes on the comparison with the trade-offs shown (${theme})`, async ({ page, context, baseURL }) => {
    await context.addCookies([{ name: 'theme', value: theme, url: baseURL ?? '' }]);
    await compare(page, TRIO);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await expectAccessible(page);
    await tradeoffs(page).getByRole('button', { name: 'Show the trade-offs' }).click();
    await expect(tradeoffs(page).getByRole('listitem')).not.toHaveCount(0);
    await expectAccessible(page);
  });
}

// AIV-P1-165: the browser's own print of the comparison, with the trade-offs shown, is the hand-off. Light ink in
// either theme: the dark tokens are screen-only.
for (const theme of themes) {
  test(`AIV-P1-165 Scenarios: The print view is a clean, safe hand-off, and Printing creates and sends nothing (${theme})`, async ({
    page,
    context,
    baseURL,
  }) => {
    await context.addCookies([{ name: 'theme', value: theme, url: baseURL ?? '' }]);
    await compare(page, TRIO);
    await tradeoffs(page).getByRole('button', { name: 'Show the trade-offs' }).click();
    await expect(tradeoffs(page).getByRole('listitem')).not.toHaveCount(0);
    const marks = await page.locator('main mark').count();
    const bases = await page.locator('main').getByText('Observed', { exact: true }).filter({ visible: true }).count();
    const sent: string[] = [];
    page.on('request', (request) => {
      if (request.method() !== 'GET') sent.push(request.method());
    });
    let downloads = 0;
    page.on('download', () => downloads++);
    await page.emulateMedia({ media: 'print' });
    // The app, not the Next.js dev tools the e2e server shows.
    const app = page.locator('body > :not(nextjs-portal)');

    // No sidebar, top bar, breadcrumb, buttons or other controls.
    await expect(app.getByRole('navigation')).toHaveCount(0);
    await expect(app.getByRole('banner')).toHaveCount(0);
    await expect(app.getByRole('button')).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Change selection' })).toBeHidden();
    await expect(page.getByRole('link', { name: 'Open decision pack' })).toBeHidden();
    // The job, the date prepared and "Confidential", in ink.
    const heading = page.getByRole('heading', { level: 1, name: 'Compare candidates' });
    expect(await css(heading, 'color')).toBe('rgb(27, 23, 32)');
    await expect(page.getByText(/^Senior AI Engineer · rubric v2\./)).toBeVisible();
    await expect(page.getByText(/^Prepared \d{1,2} [A-Z][a-z]{2} \d{4} · Confidential$/)).toBeVisible();
    // Every candidate, the trade-offs, and every citation and value-basis marker shown on screen.
    for (const name of TRIO)
      await expect(grid(page).getByRole('columnheader', { name: new RegExp(`^${name}`) })).toBeVisible();
    await expect(tradeoffs(page).getByRole('list', { name: 'Layla Haddad' }).getByRole('listitem').first()).toHaveText(
      'Layla Haddad is the only one compared with independently checked work on Arabic and bilingual NLP.',
    );
    await expect(page.locator('main mark:visible')).toHaveCount(marks);
    await expect(page.locator('main').getByText('Observed', { exact: true }).filter({ visible: true })).toHaveCount(
      bases,
    );
    // No email, phone or other contact detail.
    const text = await page.locator('body').innerText();
    expect(text).not.toMatch(/[^\s@]+@[^\s@]+\.[^\s@]+/);
    expect(text).not.toMatch(/\+\d[\d\s().-]{7,}\d/);
    // Nothing generated, downloaded or sent.
    expect(sent).toEqual([]);
    expect(downloads).toBe(0);
  });
}
