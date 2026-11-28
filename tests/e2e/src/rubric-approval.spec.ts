import { expect, test, type Browser, type Page } from '@playwright/test';
import { signIn } from './auth.ts';
import { expectAccessible, themes } from './gallery.ts';

// AIV-P1-014 J1 step: Tariq (admin of "Approvals Co", seed.ts) adds a job owned by the Head of Engineering and sends
// its rubric for approval; the Head of Engineering approves it; Tariq sees it approved, and done on My desk. Drafting
// answers from tests/e2e/ai-fixtures.json (the senior-ai-engineer case).
// Each theme runs the journey on its own job. The emails and what approval writes (RubricApproved.v1, the audit) are
// in tests/integration rubric-approval.test.ts and the notifications template tests.

const jobsRow = (page: Page, title: string) =>
  page.getByRole('row').filter({ has: page.getByRole('link', { name: title }) });
const deskItem = (page: Page, title: string) => page.getByRole('listitem').filter({ hasText: title });
const DESCRIPTION =
  'You will ship and run LLM assistants and retrieval systems that real merchants use every day. You will build ' +
  'the eval sets and retrieval metrics that decide what we ship. You will write production Python services, with ' +
  'tests, and deploy them yourself. You keep latency, cost per request and incidents in check. ' +
  'The assistant answers merchants in Arabic and English.';

async function addJobAndSend(page: Page, title: string) {
  await signIn(page, { email: 'tariq@example.com' });
  await page.goto('/app/jobs/new');
  await page.getByLabel('Job type').selectOption({ label: 'AI and LLM engineering' });
  await page.getByLabel('Job title').fill(title);
  await page.getByLabel('Job description').fill(DESCRIPTION);
  // The only hiring owner; their name is what the mocked sign-in gave them.
  await page.getByLabel('Hiring owner').selectOption({ index: 1 });
  await page.getByRole('button', { name: 'Draft competencies' }).click();
  await expect(page.getByText('Weights total 100%')).toBeVisible();
  await page.getByRole('button', { name: 'Save job and rubric' }).click();
  await expect(page.getByText(/^Job saved\./)).toBeFocused();

  // Scenario: Send version 1 for approval from Add a job.
  await page.getByRole('button', { name: 'Send rubric for approval' }).click();
  await expect(page.getByText(/^Sent to the hiring owner\./)).toHaveText(
    'Sent to the hiring owner. The job shows in Jobs as "Draft, needs approval", and My desk tells you when it is ' +
      'approved. Meanwhile you can line up people who already have evidence.',
  );
  await expectAccessible(page);
  await page.getByRole('link', { name: 'Go to Jobs' }).click();
  await expect(jobsRow(page, title)).toContainText('Draft, needs approval');
  await expect(jobsRow(page, title)).toContainText('Rubric approval pending');

  // My desk: waiting on the hiring owner.
  await page.goto('/app');
  await expect(deskItem(page, title)).toContainText(
    `Rubric approval${title}, version 1. Waiting for Head of Engineering.`,
  );
}

async function asOwner(browser: Browser, theme: string, baseURL: string) {
  const context = await browser.newContext({ baseURL });
  await context.addCookies([{ name: 'theme', value: theme, url: baseURL }]);
  const page = await context.newPage();
  await signIn(page, { email: 'head.approvals@example.com', name: 'Head of Engineering' });
  return page;
}

for (const theme of themes) {
  test(`Scenario: Approve; the recruiter sees it approved (${theme})`, async ({ page, context, browser, baseURL }) => {
    await context.addCookies([{ name: 'theme', value: theme, url: baseURL ?? '' }]);
    const title = `Approval AI Engineer ${theme} ${Date.now()}`;
    await addJobAndSend(page, title);
    const rubricUrl = `${new URL(page.url()).origin}${await deskItem(page, title)
      .getByRole('link', { name: `Open the ${title} rubric` })
      .getAttribute('href')}`;

    // The Head of Engineering opens the rubric and sees the approval panel.
    const owner = await asOwner(browser, theme, baseURL ?? '');
    await owner.goto(rubricUrl);
    const panel = owner
      .locator('section')
      .filter({ has: owner.getByRole('heading', { name: /is waiting for your approval/ }) });
    await expect(owner.getByRole('heading', { name: 'Version 1 is waiting for your approval' })).toBeVisible();
    await expect(owner.getByRole('button', { name: 'Edit rubric' })).toHaveCount(0);
    await expectAccessible(owner);

    // Return with a note opens a note field; Cancel leaves the version as it was.
    await owner.getByRole('button', { name: 'Return with a note' }).click();
    await expect(owner.getByRole('button', { name: 'Return version 1' })).toBeDisabled();
    // Before typing: a focused field's border animates, which axe can catch half-way.
    await expectAccessible(owner);
    await owner.getByRole('textbox', { name: 'Note for the recruiter' }).fill('Arabic NLP should be desirable');
    await owner.getByRole('button', { name: 'Cancel' }).click();

    // Keyboard path: approve from the keyboard.
    await owner.getByRole('button', { name: 'Approve rubric' }).focus();
    await owner.keyboard.press('Enter');
    // AIV-P1-165: the preview card opens with focus on Cancel; the reason, then Confirm, all from the keyboard.
    await expect(owner.getByRole('button', { name: 'Cancel' })).toBeFocused();
    await owner.getByRole('textbox', { name: 'Reason, recorded in the audit log' }).focus();
    await owner.keyboard.type('Matches the job description');
    await owner.getByRole('button', { name: 'Confirm approval' }).focus();
    await owner.keyboard.press('Enter');
    await expect(owner.getByRole('status').filter({ hasText: 'is approved' })).toHaveText(
      'Version 1 is approved. Assessment can now start for this job.',
    );
    await expect(owner.getByRole('listitem').filter({ hasText: /^Version 1/ })).toHaveText(
      /^Version 1, approved · .+ · \d{1,2} \w{3} \d{4}$/,
    );
    await expect(panel.getByRole('button', { name: 'Approve rubric' })).toHaveCount(0);
    await owner.context().close();

    // The recruiter sees Approved, and the desk item moves to done.
    await page.goto(rubricUrl);
    await expect(page.getByRole('link', { name: /^Competencies and rubric/ })).toContainText('Approved, version 1');
    await page.goto('/app');
    await expect(deskItem(page, title)).toContainText(`Rubric approved${title}, version 1.`);
    await expect(deskItem(page, title)).toContainText('Done');
    await expectAccessible(page);
  });
}

test('Scenario: Return with a note; the recruiter sees the note', async ({ page, browser, baseURL }) => {
  const title = `Returned AI Engineer ${Date.now()}`;
  await addJobAndSend(page, title);
  const href = await deskItem(page, title).getByRole('link').getAttribute('href');

  const owner = await asOwner(browser, 'light', baseURL ?? '');
  await owner.goto(href ?? '');
  await owner.getByRole('button', { name: 'Return with a note' }).click();
  await owner.getByRole('textbox', { name: 'Note for the recruiter' }).fill('Arabic NLP should be desirable');
  await owner.getByRole('button', { name: 'Return version 1' }).click();
  await expect(owner.getByRole('status').filter({ hasText: 'returned' })).toHaveText(
    'Version 1 was returned with your note. Nothing is assessed until a version is approved.',
  );
  await owner.context().close();

  await page.goto(href ?? '');
  await expect(page.getByRole('listitem').filter({ hasText: /^Version 1/ })).toContainText(
    'Returned with a note: “Arabic NLP should be desirable”',
  );
});

test('Scenario: Approving an outdated version is refused: an old link says a newer version is waiting', async ({
  page,
  browser,
  baseURL,
}) => {
  const title = `Outdated AI Engineer ${Date.now()}`;
  await addJobAndSend(page, title);
  const href = (await deskItem(page, title).getByRole('link').getAttribute('href')) ?? '';

  const owner = await asOwner(browser, 'light', baseURL ?? '');
  // Opened without a link, or from the current one, there is no notice; from a link to another copy, there is.
  await owner.goto(href);
  await expect(owner.getByText('A newer version is waiting for you')).toHaveCount(0);
  await owner.goto(`${href}?version=00000000-0000-4000-8000-000000000000&revision=0`);
  await expect(owner.getByText('A newer version is waiting for you')).toBeVisible();
  await expect(owner.getByRole('button', { name: 'Approve rubric' })).toBeVisible();
  await owner.context().close();
});
