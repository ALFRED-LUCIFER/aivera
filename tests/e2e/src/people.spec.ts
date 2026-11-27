import { expect, test, type Page } from '@playwright/test';
import { signIn } from './auth.ts';
import { expectAccessible, themes } from './gallery.ts';

// AIV-P1-048: Candidates (all jobs). AP's workspace "Demo" has the seeded Senior AI Engineer ranking (seed.ts); Nadia's
// workspace has no jobs. Other specs add packs and interview choices in AP's workspace, so the next step and stage are
// not asserted here (the fold's order is unit-tested in features/people/domain/people.test.ts).
const AP = 'ap@example.com';

const personRow = (page: Page, name: string) =>
  page.getByRole('row').filter({ has: page.getByRole('link', { name, exact: true }) });

test('Scenario: All jobs: opened from the sidebar, Sara appears once with her backed score', async ({ page }) => {
  await signIn(page, { email: AP });
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Candidates' }).click();
  await expect(page).toHaveURL(/\/app\/candidates$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Candidates' })).toBeVisible();
  await expect(
    page.getByText(/^Everyone in a live process on one of your jobs: \d+ people across \d+ jobs?\./),
  ).toBeVisible();
  await expect(page.getByRole('radio', { name: /^All jobs \d+$/ })).toBeChecked();

  const sara = personRow(page, 'Sara Al Qahtani');
  await expect(sara).toHaveCount(1);
  await expect(sara).toContainText('Senior AI Engineer');
  await expect(sara).toContainText('68');
  await expect(sara).toContainText('up to 84 if claims hold');
  await expect(sara).toContainText('4 of 6');
  await expect(sara.getByRole('link', { name: 'Sara Al Qahtani' })).toHaveAttribute(
    'href',
    /^\/app\/candidates\/[0-9a-f-]+\?job=[0-9a-f-]+$/,
  );
  await expect(page.getByText(/^Showing \d+ people, furthest along first\./)).toBeVisible();
});

// The fold's own mutation check is in people.test.ts; this proves it on the seeded database.
test('Scenario: Pool and Inbox are not mixed in: nobody not yet assessed is listed', async ({ page }) => {
  await signIn(page, { email: AP });
  await page.goto('/app/candidates');
  await expect(personRow(page, 'Sara Al Qahtani')).toHaveCount(1);
  await expect(page.getByText('Not yet scored')).toHaveCount(0);
  await expect(page.getByText('In talent pool')).toHaveCount(0);
});

test('Scenario: One job tab, by keyboard, kept in the URL', async ({ page }) => {
  await signIn(page, { email: AP });
  await page.goto('/app/candidates');
  const all = page.getByRole('radio', { name: /^All jobs \d+$/ });
  await all.focus();
  await page.keyboard.press('ArrowRight');
  const job = page.getByRole('radio', { name: /^Senior AI Engineer \d+$/ });
  await expect(job).toBeChecked();
  await expect(page).toHaveURL(/\/app\/candidates\?job=[0-9a-f-]+$/);
  await expect(personRow(page, 'Sara Al Qahtani')).toHaveCount(1);
  await page.reload();
  await expect(page.getByRole('radio', { name: /^Senior AI Engineer \d+$/ })).toBeChecked();
});

// Workspace isolation is the contracts' repository filter and row-level security (ADR-005), each tested there.
test('Scenario: No live jobs: a workspace sees only its own people', async ({ page }) => {
  await signIn(page, { email: 'nadia@example.com' });
  await page.goto('/app/candidates');
  await expect(page.getByText('No one in a live process yet')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Add a job' }).last()).toHaveAttribute('href', '/app/jobs/new');
  await expect(page.getByRole('link', { name: 'Sara Al Qahtani' })).toHaveCount(0);
});

test('an interviewer cannot open Candidates: 404, and no link in the sidebar', async ({ page }) => {
  await signIn(page, { email: 'noor.panel@example.com' });
  await expect(page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Candidates' })).toHaveCount(
    0,
  );
  // The page streams behind loading.tsx, so the refusal is the not-found page, not a 404 status; requireScreen refuses
  // before anything is read.
  const response = await page.goto('/app/candidates');
  await expect(page.getByRole('heading', { level: 1, name: 'We could not find that page.' })).toBeVisible();
  expect(await response?.text()).not.toContain('Sara Al Qahtani');
});

for (const theme of themes) {
  test(`axe passes on Candidates, populated and empty (${theme})`, async ({ page, context }) => {
    await context.addCookies([{ name: 'theme', value: theme, url: 'http://localhost:3200' }]);
    await signIn(page, { email: AP });
    await page.goto('/app/candidates');
    await expect(personRow(page, 'Sara Al Qahtani')).toHaveCount(1);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await expectAccessible(page);
    await signIn(page, { email: 'nadia@example.com' });
    await page.goto('/app/candidates');
    await expect(page.getByText('No one in a live process yet')).toBeVisible();
    await expectAccessible(page);
  });
}
