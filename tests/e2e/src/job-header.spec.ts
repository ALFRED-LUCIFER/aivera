import { expect, test, type Page } from '@playwright/test';
import { signIn } from './auth.ts';
import { expectAccessible, themes } from './gallery.ts';

// AIV-P1-011: AP's workspace "Demo" (seed.ts). Senior AI Engineer was added 3 Nov and has version 2 approved; Senior
// Product Designer has a draft. Assessment, interviews and packs are not built yet, so those stages are not started.
const AP = 'ap@example.com';

/** Opens a job from the Jobs list and returns its id. */
async function openJob(page: Page, title: string) {
  await page.goto('/app/jobs');
  await page.getByRole('link', { name: title }).click();
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
  return /\/app\/jobs\/([0-9a-f-]+)\//.exec(page.url())?.[1] ?? '';
}

const stages = (page: Page) => page.getByRole('navigation', { name: 'Stages of this job' }).getByRole('link');

test('Scenario: Senior AI Engineer header', async ({ page }) => {
  await signIn(page, { email: AP });
  await openJob(page, 'Senior AI Engineer');
  await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toHaveText('Jobs/Senior AI Engineer');
  // Not yet "· 64 candidates assessed": assessment (AIV-P1-031) reports no count, and none is invented.
  await expect(page.getByText('Engineering · DIFC, Dubai · Hiring owner: Head of Engineering')).toBeVisible();
  await expect(page.getByText('Approved', { exact: true })).toBeVisible();
  await expect(stages(page)).toHaveText([
    'Job descriptionSaved 3 Nov',
    'Competencies and rubricApproved, version 2',
    'Evidence and rankingNot started',
    'InterviewsNot started',
    'DecisionNot started',
  ]);
});

test('Scenario: A job waiting for approval', async ({ page }) => {
  await signIn(page, { email: AP });
  await openJob(page, 'Senior Product Designer');
  await expect(page.getByText('Draft, needs approval', { exact: true })).toBeVisible();
  await expect(stages(page).nth(2)).toHaveText('Evidence and rankingStarts after rubric approval');
  // A stage not reached stays reachable and says why it is empty.
  await stages(page).nth(2).click();
  await expect(page).toHaveURL(/\/candidates$/);
  await expect(page.getByText('No ranking yet.', { exact: false })).toBeVisible();
});

// mutation check: aria-current set on every stage link -> this test failed (5 current links)
test('Scenario: The current stage is marked, and the stages are keyboard reachable', async ({ page }) => {
  await signIn(page, { email: AP });
  const id = await openJob(page, 'Senior Product Designer');
  await expect(page).toHaveURL(`/app/jobs/${id}/rubric`);
  await expect(page.getByRole('link', { name: /^Competencies and rubric/ })).toHaveAttribute('aria-current', 'page');
  await expect(stages(page).and(page.locator('[aria-current]'))).toHaveCount(1);
  await stages(page).first().focus();
  await page.keyboard.press('Tab');
  await expect(stages(page).nth(1)).toBeFocused();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(`/app/jobs/${id}/candidates`);
  await expect(page.getByRole('link', { name: /^Evidence and ranking/ })).toHaveAttribute('aria-current', 'page');
});

test('Scenario: Unknown or other-workspace job', async ({ page, context }) => {
  await signIn(page, { email: AP });
  const id = await openJob(page, 'Senior AI Engineer');
  await context.clearCookies({ name: '__Host-credalent-session' });
  // Alex runs "Demo Hiring Co", another workspace.
  await signIn(page, { email: 'alex@example.com' });
  const response = await page.goto(`/app/jobs/${id}/rubric`);
  expect(response?.status()).toBe(404);
  await expect(page.getByText('This job does not exist or you do not have access.')).toBeVisible();
  expect((await page.goto('/app/jobs/not-a-job/rubric'))?.status()).toBe(404);
  // An interviewer, who sees only granted jobs, is refused instead.
  await context.clearCookies({ name: '__Host-credalent-session' });
  await signIn(page, { email: 'rami@example.com' });
  expect((await page.goto(`/app/jobs/${id}/rubric`))?.status()).toBe(403);
});

for (const theme of themes) {
  test(`axe passes on the job header (${theme})`, async ({ page, context, baseURL }) => {
    await context.addCookies([{ name: 'theme', value: theme, url: baseURL ?? '' }]);
    await signIn(page, { email: AP });
    await openJob(page, 'Senior AI Engineer');
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    // The title streams in after the heading; axe reads it (document-title), as in add-applicants.spec.ts.
    await expect(page).toHaveTitle('Senior AI Engineer: Evidence and ranking · Credalent');
    await expectAccessible(page);
  });
}
