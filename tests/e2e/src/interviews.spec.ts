import { expect, test, type Page } from '@playwright/test';
import { signIn } from './auth.ts';
import { expectAccessible, themes } from './gallery.ts';

// AIV-P2-002, journey J3: the Interviews list. AP's workspace "Demo" has four ongoing interviews and one completed on
// its Senior AI Engineer job, on days counted from the seed's run (seed.ts); Nadia's workspace has none.
const AP = 'ap@example.com';
const EMPTY = 'No interviews yet. Interviews are scheduled from a job’s ranking or decision pack.';

const row = (page: Page, candidate: string) => page.getByRole('row').filter({ hasText: candidate });

test('Scenario: Ongoing interviews', async ({ page }) => {
  await signIn(page, { email: AP });
  await page.goto('/app/interviews');
  await expect(page.getByRole('heading', { level: 1, name: 'Interviews' })).toBeVisible();
  await expect(page.getByText('Each interview exists to test specific evidence.', { exact: false })).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Ongoing 4' })).toBeChecked();
  await expect(page.getByRole('radio', { name: 'Completed 1' })).toBeVisible();
  // The sidebar count is the ongoing interviews.
  await expect(
    page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Interviews 4' }),
  ).toHaveAttribute('aria-current', 'page');

  // What is under way leads the list; then what is coming, soonest first; then the overdue scorecard.
  const table = page.getByRole('table', { name: 'Interviews' });
  await expect(table.locator('tbody tr td:first-child')).toHaveText([
    /^Daniel Novak/,
    /^Priya Nair/,
    /^Arjun Menon/,
    /^Layla Haddad/,
  ]);
  await expect(row(page, 'Daniel Novak').getByRole('cell')).toHaveText([
    'Daniel NovakSenior AI Engineer',
    'Round 1, structured screen',
    'You',
    'Today, 14:00',
    'In progress',
    'Retrieval and evaluation, Cost and reliability',
    'Open scorecard',
  ]);
  // Round 2 with another interviewer, on a later day at 11:00 in the workspace time zone. No guide exists until
  // AIV-P2-003, so the list never says "Guide ready".
  await expect(row(page, 'Arjun Menon').getByRole('cell')).toHaveText([
    'Arjun MenonSenior AI Engineer',
    'Round 2, evidence defence',
    'Head of Engineering',
    /^\d{1,2} [A-Z][a-z]{2}, 11:00$/,
    'Scheduled',
    'Retrieval and evaluation',
    'No guide yet',
  ]);
  await expect(page.getByText('Guide ready')).toHaveCount(0);
});

test('Scenario: Overdue scorecard', async ({ page }) => {
  await signIn(page, { email: AP });
  await page.goto('/app/interviews');
  const cells = row(page, 'Layla Haddad').getByRole('cell');
  await expect(cells.nth(4)).toHaveText('Scorecard due');
  await expect(cells.nth(6)).toHaveText('Scorecard due, 2 days');
});

// Where "Open scorecard" leads; scorecard.spec.ts (AIV-P2-004) follows the link.
test('Scenario: Open a scorecard (the link), by keyboard', async ({ page }) => {
  await signIn(page, { email: AP });
  await page.goto('/app/interviews');
  const open = row(page, 'Daniel Novak').getByRole('link', { name: 'Open scorecard' });
  await expect(open).toHaveAttribute('href', /^\/app\/interviews\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('table', { name: 'Interviews' }).getByRole('link')).toHaveCount(1);
  // Tab moves on from the tabs into the table; when the table is wider than its box, the box is a stop on the way.
  await page.getByRole('radio', { name: 'Ongoing 4' }).focus();
  await page.keyboard.press('Tab');
  if (!(await open.evaluate((el) => el === document.activeElement))) await page.keyboard.press('Tab');
  await expect(open).toBeFocused();
});

test('Scenario: Completed tab and summary, by keyboard', async ({ page }) => {
  await signIn(page, { email: AP });
  await page.goto('/app/interviews');
  await page.getByRole('radio', { name: 'Ongoing 4' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('radio', { name: 'Completed 1' })).toBeChecked();
  const table = page.getByRole('table', { name: 'Interviews' });
  await expect(table.locator('tbody tr')).toHaveCount(1);
  const cells = row(page, 'Sara Al Qahtani').getByRole('cell');
  await expect(cells.nth(4)).toHaveText('Completed');
  await expect(cells.nth(6)).toHaveText('');
  // The count states its basis (AGENTS.md 1.7).
  await expect(page.getByText('1 interview completed with 1 person across 1 job so far.')).toContainText('Observed');
});

test('Scenario: Empty state', async ({ page }) => {
  await signIn(page, { email: 'nadia@example.com' });
  await page.goto('/app/interviews');
  await expect(page.getByText(EMPTY)).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Ongoing 0' })).toBeChecked();
  await expect(page.getByText(/so far\.$/)).toHaveCount(0);
  // No ongoing interview: the sidebar shows no count.
  await expect(
    page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Interviews', exact: true }),
  ).toBeVisible();
});

// Daniel's interview is real, in AP's workspace: Nadia, in her own, gets the same 404 as for an id that never existed
// (the contract's `getScorecard` returns null for it, tested on PostgreSQL in tests/integration/src/interviews.test.ts).
test("Scenario: Another workspace's interviews are not reachable", async ({ page, context }) => {
  await signIn(page, { email: AP });
  await page.goto('/app/interviews');
  const theirs = await row(page, 'Daniel Novak').getByRole('link', { name: 'Open scorecard' }).getAttribute('href');
  expect(theirs).toMatch(/^\/app\/interviews\/[0-9a-f-]{36}$/);
  expect((await page.goto(theirs ?? ''))?.status()).toBe(200);
  await context.clearCookies({ name: '__Host-credalent-session' });
  await signIn(page, { email: 'nadia@example.com' });
  for (const path of [theirs ?? '', '/app/interviews/0190d4a2-0000-7000-8000-00000000beef', '/app/interviews/daniel']) {
    expect((await page.goto(path))?.status()).toBe(404);
    await expect(page.getByRole('heading', { level: 1, name: 'We could not find that page.' })).toBeVisible();
  }
});

for (const theme of themes) {
  test(`axe passes on Interviews: ongoing, completed and empty (${theme})`, async ({ page, context }) => {
    await context.addCookies([{ name: 'theme', value: theme, url: 'http://localhost:3200' }]);
    await signIn(page, { email: AP });
    await page.goto('/app/interviews');
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await expect(page.getByRole('radio', { name: 'Ongoing 4' })).toBeVisible();
    await expectAccessible(page);
    await page.getByRole('radio', { name: 'Ongoing 4' }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(row(page, 'Sara Al Qahtani')).toBeVisible();
    await expectAccessible(page);
    await context.clearCookies({ name: '__Host-credalent-session' });
    await signIn(page, { email: 'nadia@example.com' });
    await page.goto('/app/interviews');
    await expect(page.getByText(EMPTY)).toBeVisible();
    await expectAccessible(page);
  });
}
