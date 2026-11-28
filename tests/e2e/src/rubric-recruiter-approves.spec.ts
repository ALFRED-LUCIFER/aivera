import { expect, test, type Page } from '@playwright/test';
import { signIn } from './auth.ts';
import { expectAccessible, primaryButtons, themes } from './gallery.ts';
import { approvedWorkspace } from './workspaces.ts';

// AIV-P1-083 (ADR-014): the recruiter on a job approves its rubric. A recruiter alone in a fresh workspace with no
// hiring owner adds a job and approves its draft rubric themselves, from the keyboard, with no
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
    // A solo workspace of its own: Nadia's must stay empty for jobs-list.spec.ts "Empty workspace".
    const solo = `solo.rubric.${theme}.${Date.now()}@example.com`;
    await approvedWorkspace(solo, `Solo ${theme} ${Date.now()}`);
    await signIn(page, { email: solo });
    await page.waitForURL(/\/app/);
    const title = `Solo AI Engineer ${theme} ${Date.now()}`;
    await page.goto(await addJob(page, title));

    await expect(page.getByRole('heading', { name: 'Version 1 is ready for you to approve' })).toBeVisible();
    // Her own draft: approve it, nothing to return it to, and no "on behalf of the hiring owner" note.
    await expect(page.getByRole('button', { name: 'Return with a note' })).toHaveCount(0);
    await expect(page.getByText(/on their behalf/)).toHaveCount(0);
    // AIV-P1-165 "No empty success box": before any decision the panel's status region is empty and draws nothing.
    const panel = page
      .locator('section')
      .filter({ has: page.getByRole('heading', { name: /ready for you to approve/ }) });
    // (The empty live region has no box, so it is found by its element, not its role.)
    await expect(panel.locator('output')).toBeEmpty();
    await expect(panel.locator('output')).toHaveClass('');
    expect((await panel.locator('output').boundingBox())?.height ?? 0).toBe(0);
    // AIV-P1-165 "Levels and Mandatory are explained where they appear".
    await expect(page.getByText('Mandatory never rejects anyone automatically.', { exact: false })).toBeVisible();
    const levels = page
      .getByRole('table', { name: 'Agreed competencies' })
      .getByRole('cell', { name: /^Level \d of 5/ });
    await expect(levels).toHaveCount(6);
    for (const level of await levels.all()) await expect(level).toHaveText(/^Level \d of 5\S.+\.$/);
    // AIV-P1-165 "Scoring definitions are behind a toggle": collapsed, and Enter on the toggle expands them.
    const claim = page.getByText('Stated, with nothing to inspect. Counts as zero.');
    await expect(claim).toBeHidden();
    await page.getByText('Show scoring definitions').focus();
    await page.keyboard.press('Enter');
    await expect(claim).toBeVisible();
    await expectAccessible(page);
    await expect(primaryButtons(page)).toHaveText(['Approve rubric']);

    // SAFETY: mutation check: hid the panel for 'recruiter' approvers (RubricEditable review = rubric.review only) -> this
    // test failed (no "ready for you to approve" heading)
    // AIV-P1-165 "Approving is confirmed and audited": the shared preview-confirm card, from the keyboard.
    const approve = page.getByRole('button', { name: 'Approve rubric' });
    await approve.focus();
    await page.keyboard.press('Enter');
    const card = page.getByRole('dialog', { name: 'Preview: approve rubric version 1' });
    await expect(card.getByRole('listitem')).toHaveCount(6);
    await expect(card.getByRole('listitem').first()).toHaveText(/\d+% · Level \d of 5 · (Mandatory|Desirable)$/);
    await expect(card).toContainText('Nothing changes until you confirm.');
    await expect(card.getByRole('button', { name: 'Cancel' })).toBeFocused();
    await expect(card.getByRole('button', { name: 'Confirm approval' })).toBeDisabled();
    await expectAccessible(page);
    // Cancel: the rubric stays a draft (what cancelling writes, nothing, is the controller's unit test).
    await page.keyboard.press('Enter');
    await expect(card).toBeHidden();
    await expect(approve).toBeFocused();
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Version 1 is ready for you to approve' })).toBeVisible();
    await expect(page.getByRole('link', { name: /^Competencies and rubric/ })).toContainText('Draft, version 1');

    // Confirm with a reason.
    await approve.focus();
    await page.keyboard.press('Enter');
    await card.getByRole('textbox', { name: 'Reason, recorded in the audit log' }).focus();
    await page.keyboard.type('Matches the job description');
    await card.getByRole('button', { name: 'Confirm approval' }).focus();
    await page.keyboard.press('Enter');
    await expect(
      page.getByRole('status').filter({ hasText: 'Version 1 is approved. Assessment can now start for this job.' }),
    ).toBeVisible();
    await expect(card).toBeHidden();
    await expect(approve).toHaveCount(0);
    await expect(page.getByRole('link', { name: /^Competencies and rubric/ })).toContainText('Approved, version 1');
    // AIV-P1-165 "After approval, one next step": "Add CVs" is the page's one primary button.
    await expect(primaryButtons(page)).toHaveText(['Add CVs']);
    await expectAccessible(page);
  });
}

// Scenario: the hiring owner is contacted only when the recruiter chooses. Tariq (admin of "Approvals Co", whose hiring
// owner is the Head of Engineering) sends a draft from its rubric page; the email itself is rubricEmails.test.ts.
for (const theme of themes)
  test(`Scenario: The recruiter chooses to send a draft to the hiring owner (${theme})`, async ({
    page,
    context,
    baseURL,
  }) => {
    await context.addCookies([{ name: 'theme', value: theme, url: baseURL ?? '' }]);
    await signIn(page, { email: 'tariq@example.com' });
    await page.waitForURL(/\/app/);
    await page.goto(await addJob(page, `Owner-checked AI Engineer ${theme} ${Date.now()}`, true));
    await expect(page.getByRole('heading', { name: 'Version 1 is ready for you to approve' })).toBeVisible();
    await expectAccessible(page);
    await page.getByRole('button', { name: 'Send to the hiring owner' }).click();
    await expect(
      page.getByRole('status').filter({
        hasText:
          'Sent to the hiring owner. They can approve it or return it with a note. You can still approve it yourself.',
      }),
    ).toBeVisible();
    // Sent, it waits for the hiring owner; the recruiter may still approve it but never returns it to themselves.
    await expect(page.getByRole('heading', { name: 'Version 1 is with the hiring owner' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Approve rubric' })).toBeVisible();
    await expectAccessible(page);
    await expect(page.getByRole('button', { name: 'Return with a note' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Send to the hiring owner' })).toHaveCount(0);
  });
