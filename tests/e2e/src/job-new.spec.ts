import { expect, test, type Page } from '@playwright/test';
import { signIn } from './auth.ts';
import { expectNoAxeViolations, themes } from './gallery.ts';

// AIV-P1-007 J1 step 3, Add a job step 1 (seed.ts: Alex at Demo Hiring Co with hiring owner "Head of Engineering" and
// interviewer Rami; Nadia Freelance has no hiring owner).

const open = async (page: Page, email = 'alex@example.com') => {
  await signIn(page, { email });
  await page.goto('/app/jobs/new');
  await expect(page.getByRole('heading', { level: 1, name: 'Add a job' })).toBeVisible();
};
const draft = (page: Page) => page.getByRole('button', { name: 'Draft competencies' });

for (const theme of themes) {
  test(`J1: fill step 1 for Senior AI Engineer from the keyboard (${theme})`, async ({ page, context }) => {
    await context.addCookies([{ name: 'theme', value: theme, url: 'http://localhost:3200' }]);
    await open(page);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await expect(page.getByText('1. Job and description')).toHaveAttribute('aria-current', 'step');
    await expect(page.getByText('The job type sets which kinds of work count as evidence.')).toBeVisible();
    await expectNoAxeViolations(page);

    const jobType = page.getByLabel('Job type');
    await jobType.focus();
    await jobType.selectOption({ label: 'AI and LLM engineering' });
    await page.keyboard.press('Tab');
    await expect(page.getByLabel('Job title')).toBeFocused();
    await page.keyboard.type('Senior AI Engineer');
    await page.keyboard.press('Tab');
    await expect(page.getByLabel('Job description')).toBeFocused();
    await page.keyboard.type('LLM systems in production for merchant support.');
    await page.keyboard.press('Tab');
    await expect(page.getByLabel('Team')).toBeFocused();
    await page.keyboard.type('Engineering');
    await page.keyboard.press('Tab');
    await expect(page.getByLabel('Location')).toBeFocused();
    await page.keyboard.type('DIFC, Dubai');
    await page.keyboard.press('Tab');
    const owner = page.getByLabel('Hiring owner');
    await expect(owner).toBeFocused();
    await owner.selectOption({ label: 'Head of Engineering' });
    await page.keyboard.press('Tab');
    await expect(draft(page)).toBeFocused();
    // Drafting is job-draft.spec.ts (AIV-P1-008) and saving job-save.spec.ts (AIV-P1-010): a job is saved with its
    // rubric, so saving before any competency is kept asks for one and stores nothing.
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Save job and rubric' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('alert').filter({ hasText: 'Keep at least' })).toHaveText(
      'Keep at least one competency to save the job and rubric.',
    );
    await expect(page).toHaveURL(/\/app\/jobs\/new$/);
  });
}

test('Scenario Outline: The description placeholder follows the job type', async ({ page }) => {
  await open(page);
  for (const [type, first] of [
    ['Software engineering', 'System design in production'],
    ['AI and LLM engineering', 'LLM systems in production'],
    ['Sales', 'Closing sales'],
    ['QA and test automation', 'Test automation design'],
    ['Product design', 'Interaction design craft'],
    ['Technical writing and support', 'Clear task documentation'],
  ] as const) {
    await page.getByLabel('Job type').selectOption({ label: type });
    const placeholder = await page.getByLabel('Job description').getAttribute('placeholder');
    expect(placeholder?.split('\n')[1], type).toBe(`- ${first}`);
  }
});

test('Scenario: Required fields', async ({ page }) => {
  await open(page);
  await page.getByLabel('Job type').selectOption({ label: 'AI and LLM engineering' });
  await page.getByLabel('Job description').fill('Builds LLM features.');
  await draft(page).click();
  await expect(page.getByText('Add a job title.')).toBeVisible();
  await expect(page.getByLabel('Job title')).toHaveAttribute('aria-invalid', 'true');
  await expect(page).toHaveURL(/\/app\/jobs\/new$/);
  // What was typed stays, and a one-line description is fine.
  await expect(page.getByLabel('Job description')).toHaveValue('Builds LLM features.');
  await expect(page.getByText('Paste what you have, even if it is thin.')).toBeVisible();
  await expectNoAxeViolations(page);
});

test('Scenario: Hiring owner comes from the workspace', async ({ page }) => {
  await open(page);
  const options = await page.getByLabel('Hiring owner').locator('option').allTextContents();
  expect(options).toContain('Head of Engineering');
  expect(options).not.toContain('Alex Recruiter');
  expect(options).not.toContain('Rami Panel');
});

test('Scenario: No hiring owner yet', async ({ page }) => {
  await open(page, 'nadia@example.com');
  await expect(page.getByRole('link', { name: 'Invite a hiring owner' })).toHaveAttribute(
    'href',
    '/app/settings/members',
  );
});

test('Scenario: Discard draft with unsaved input asks first', async ({ page }) => {
  await open(page);
  await page.getByLabel('Job title').fill('Senior AI Engineer');
  await page.getByRole('button', { name: 'Discard draft' }).click();
  const dialog = page.getByRole('dialog', { name: 'Discard this job?' });
  await expect(dialog).toBeVisible();
  await expectNoAxeViolations(page);
  await dialog.getByRole('button', { name: 'Keep editing' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByLabel('Job title')).toHaveValue('Senior AI Engineer');

  await page.getByRole('button', { name: 'Discard draft' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Discard', exact: true }).click();
  await expect(page).toHaveURL(/\/app\/jobs$/);
});

test('Discard draft with nothing typed opens Jobs at once', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Discard draft' }).click();
  await expect(page).toHaveURL(/\/app\/jobs$/);
});

for (const theme of themes) {
  test(`Scenario: Only recruiters and admins can add jobs (${theme})`, async ({ page, context }) => {
    await context.addCookies([{ name: 'theme', value: theme, url: 'http://localhost:3200' }]);
    await signIn(page, { email: 'rami@example.com' });
    const response = await page.goto('/app/jobs/new');
    expect(response?.status()).toBe(403);
    await expect(page.getByText('You do not have access to add jobs.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Draft competencies' })).toHaveCount(0);
    await expectNoAxeViolations(page);
  });
}
