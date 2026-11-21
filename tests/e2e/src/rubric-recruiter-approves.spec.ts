import { expect, test, type Page } from '@playwright/test';
import { signIn } from './auth.ts';
import { expectAccessible, themes } from './gallery.ts';

// AIV-P1-083 (ADR-014): the recruiter on a job approves its rubric. Nadia Freelance runs a one-person workspace with no
// hiring owner (seed.ts, personas.md): she adds a job and approves its draft rubric herself, from the keyboard, with no
// "Return with a note" and no one contacted. Drafting answers from tests/e2e/ai-fixtures.json (senior-ai-engineer).
// What approval writes (RubricApproved.v1, the audit as `recruiter`) is in tests/integration rubric-approval.test.ts.

const DESCRIPTION =
  'You will ship and run LLM assistants and retrieval systems that real merchants use every day. You will build ' +
  'the eval sets and retrieval metrics that decide what we ship. You will write production Python services, with ' +
  'tests, and deploy them yourself. You keep latency, cost per request and incidents in check. ' +
  'The assistant answers merchants in Arabic and English.';

async function addJob(page: Page, title: string, withOwner = false) {
  await page.goto('/app/jobs/new');
  await page.getByLabel('Job type').selectOption({ label: 'AI and LLM engineering' });
  await page.getByLabel('Job title').fill(title);
  await page.getByLabel('Job description').fill(DESCRIPTION);
  // The workspace's only hiring owner, when it has one.
  if (withOwner) await page.getByLabel('Hiring owner').selectOption({ index: 1 });
  await page.getByRole('button', { name: 'Draft competencies' }).click();
  await expect(page.getByText('Weights total 100%')).toBeVisible();
  await page.getByRole('button', { name: 'Save job and rubric' }).click();
  await expect(page.getByText(/^Job saved\./)).toBeFocused();
  await expect(
    page.getByText('Next: approve the rubric on its page. Candidates are assessed only after that.'),
  ).toBeVisible();
  // A job with no approved rubric links straight to its rubric page (jobsList.ts jobHref).
  await page.goto('/app/jobs');
  return (await page.getByRole('link', { name: title }).getAttribute('href')) ?? '';
}

for (const theme of themes) {
  test(`Scenario: A solo recruiter approves their own draft rubric, from the keyboard (${theme})`, async ({
    page,
    context,
    baseURL,
  }) => {
    await context.addCookies([{ name: 'theme', value: theme, url: baseURL ?? '' }]);
    await signIn(page, { email: 'nadia@example.com' });
    await page.waitForURL(/\/app/);
    const title = `Solo AI Engineer ${theme} ${Date.now()}`;
    await page.goto(await addJob(page, title));

    await expect(page.getByRole('heading', { name: 'Version 1 is ready for you to approve' })).toBeVisible();
    // Her own draft: approve it, nothing to return it to, and no "on behalf of the hiring owner" note.
    await expect(page.getByRole('button', { name: 'Return with a note' })).toHaveCount(0);
    await expect(page.getByText(/on their behalf/)).toHaveCount(0);
    await expectAccessible(page);

    // SAFETY: mutation check: hid the panel for 'recruiter' approvers (RubricEditable review = rubric.review only) -> this
    // test failed (no "ready for you to approve" heading)
    await page.getByRole('button', { name: 'Approve version 1' }).focus();
    await page.keyboard.press('Enter');
    await expect(
      page.getByRole('status').filter({ hasText: 'Version 1 is approved. Assessment can now start for this job.' }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Approve version 1' })).toHaveCount(0);
  });
}

// Scenario: the hiring owner is contacted only when the recruiter chooses. Tariq (admin of "Approvals Co", whose hiring
// owner is the Head of Engineering) sends a draft from its rubric page; the email itself is rubricEmails.test.ts.
test('Scenario: The recruiter chooses to send a draft to the hiring owner', async ({ page }) => {
  await signIn(page, { email: 'tariq@example.com' });
  await page.waitForURL(/\/app/);
  await page.goto(await addJob(page, `Owner-checked AI Engineer ${Date.now()}`, true));
  await expect(page.getByRole('heading', { name: 'Version 1 is ready for you to approve' })).toBeVisible();
  await page.getByRole('button', { name: 'Send to the hiring owner' }).click();
  await expect(
    page.getByRole('status').filter({
      hasText:
        'Sent to the hiring owner. They can approve it or return it with a note; you can still approve it yourself.',
    }),
  ).toBeVisible();
  // Sent, it waits for the hiring owner; the recruiter may still approve it but never returns it to themselves.
  await expect(page.getByRole('heading', { name: 'Version 1 is with the hiring owner' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approve version 1' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Return with a note' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Send to the hiring owner' })).toHaveCount(0);
});
