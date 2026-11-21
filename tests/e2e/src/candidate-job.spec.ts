import { expect, test, type Page } from '@playwright/test';
import { expectAccessible, themes } from './gallery.ts';

// AIV-P3-005, journey J5 step 4: each of the five synthetic jobs published by seed.ts, opened from the jobs list.
const open = async (page: Page, title: string) => {
  await page.goto('/candidates/jobs');
  await page.getByRole('link', { name: `View job: ${title}` }).click();
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
};

for (const [title, descriptor, pay, competency, evidence] of [
  [
    'Senior AI Engineer',
    'A BNPL fintech · DIFC, Dubai',
    'AED 35,000 to 48,000 a month',
    'LLM systems in production',
    'A shipped assistant or RAG system with real users, and their part in it',
  ],
  [
    'QA Automation Engineer',
    'A logistics platform · Dubai, hybrid',
    'Pay band not disclosed',
    'Test automation design',
    'A test suite they wrote, and what it covers',
  ],
  [
    'Senior Product Manager, Payments',
    'A payments scale-up · Dubai Internet City',
    'AED 38,000 to 50,000 a month',
    'Discovery to decision',
    'Research write-ups that show how evidence became a decision',
  ],
  [
    'Real Estate Sales Consultant',
    'A property brokerage · Dubai',
    'Pay band not disclosed',
    'Closing sales',
    'Deals they closed, with the value and their part confirmed',
  ],
  [
    'Senior Software Engineer, Banking',
    'A retail bank · Dubai',
    'Pay band not disclosed',
    'System design in production',
    'A service they designed that runs in production, and the trade-offs they made',
  ],
] as const) {
  test(`${title}: its own needs, with the evidence and level`, async ({ page }) => {
    await open(page, title);
    await expect(page.getByText(descriptor, { exact: true })).toBeVisible();
    await expect(page.getByText(pay, { exact: true })).toBeVisible();
    const needs = page.getByRole('region', { name: 'What this job needs' });
    await expect(needs.getByRole('listitem')).toHaveCount(6);
    const row = needs.getByRole('listitem').filter({ has: page.getByRole('heading', { name: competency }) });
    await expect(row).toContainText(evidence);
    await expect(row).toContainText('4 of 5');
    // Private fields are never shown: no weight, client name, other candidate or score.
    await expect(page.getByRole('main')).not.toContainText(/weight|%|score/i);
  });
}

test('the page states how candidates are judged and links to no unbuilt page', async ({ page }) => {
  await open(page, 'Senior AI Engineer');
  const judged = page.getByRole('region', { name: 'How you will be judged' });
  await expect(judged).toContainText('On work you can show. There is no test.');
  await expect(judged).toContainText(
    'What you state without evidence is treated as a claim, and you may be asked for more.',
  );
  await expect(judged).toContainText('A person makes every decision. Nobody is rejected automatically.');
  // AIV-P1-095: no Apply, CV check or Plans link until those pages are built.
  await expect(page.getByRole('main').getByRole('link')).toHaveCount(0);
});

test('a job that is no longer open answers 404 with a link to all jobs', async ({ page }) => {
  const response = await page.goto('/candidates/jobs/no-longer-open-000000000000');
  expect(response?.status()).toBe(404);
  await expect(page.getByRole('heading', { level: 1, name: 'This job is no longer open' })).toBeVisible();
  await page.getByRole('link', { name: 'See all jobs' }).click();
  await expect(page).toHaveURL('/candidates/jobs');
});

for (const theme of themes)
  for (const title of ['Senior AI Engineer', 'Real Estate Sales Consultant'])
    test(`axe passes on ${title} (${theme})`, async ({ page, context }) => {
      await context.addCookies([{ name: 'theme', value: theme, url: 'http://localhost:3200' }]);
      await open(page, title);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await expectAccessible(page);
    });
