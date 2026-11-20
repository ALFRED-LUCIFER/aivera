import { expect, test } from '@playwright/test';
import { signIn } from './auth.ts';
import { expectNoAxeViolations, themes } from './gallery.ts';
import { approvalRow, PIA, signUpWorkspace, WAITING } from './workspaces.ts';

// AIV-P2-039 (ADR-012): new workspaces wait for an operator while the pilot runs. Each run signs up fresh synthetic
// addresses (the Nadia Freelance persona), so a reused local database works too. "New workspaces need approval" stays
// on here: turning it off would change every other spec's sign-up running in parallel, so the change itself is proven
// in tests/integration/src/ops-approvals.test.ts and the card in Approvals.test.tsx; this spec opens its preview only.
// The approval emails are not sent yet (AIV-P0-017 is not built). Synthetic people only.

for (const theme of themes) {
  test(`J1: sign up, wait, the operator approves, add a job, by keyboard (${theme})`, async ({
    browser,
    page,
    context,
    baseURL,
  }) => {
    const base = baseURL ?? '';
    const stamp = `${theme}-${Date.now()}`;
    const name = `Nadia Freelance ${stamp}`;
    const email = `nadia+approve-${stamp}@example.com`;
    const urls: string[] = [];
    // Scenario: A sign-up waits for approval
    const nadia = await signUpWorkspace(browser, base, email, name);
    nadia.page.on('request', (request) => urls.push(decodeURIComponent(request.url())));
    await nadia.context.addCookies([{ name: 'theme', value: theme, url: base }]);
    for (const path of ['/app', '/app/jobs', '/app/candidates']) {
      await nadia.page.goto(path);
      await expect(nadia.page.getByRole('heading', { level: 1, name: 'Waiting for approval' })).toBeVisible();
      await expect(nadia.page.getByText(WAITING)).toBeVisible();
    }
    await expect(nadia.page.locator('html')).toHaveAttribute('data-theme', theme);
    await expectNoAxeViolations(nadia.page);
    // Add a job shows the same page; the refusal of the add itself (403) is the request context's, proven in
    // tests/integration/src/ops-approvals.test.ts and apps/web/src/server/workspace.test.ts.
    await nadia.page.goto('/app/jobs/new');
    await expect(nadia.page.getByText(WAITING)).toBeVisible();

    // Scenario: Non-operators cannot decide
    expect((await nadia.page.goto('/ops/approvals'))?.status()).toBe(403);

    // Scenario: The operator approves
    await context.addCookies([{ name: 'theme', value: theme, url: base }]);
    await signIn(page, { email: PIA });
    await page.goto('/ops/approvals');
    await expect(page.getByRole('heading', { level: 1, name: 'Approvals' })).toBeVisible();
    const row = approvalRow(page, name);
    await expect(row.getByRole('cell')).toHaveText([
      name,
      'In-house team',
      /^\d{1,2} [A-Z][a-z]{2} \d{4}$/,
      'Less than a day',
      email,
      /Approve/,
    ]);
    await expectNoAxeViolations(page);
    const approve = row.getByRole('button', { name: `Approve ${name}` });
    await approve.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: `Approve ${name}?` });
    await expect(dialog).toContainText('Nothing changes until you confirm.');
    await expectNoAxeViolations(page);
    const confirm = dialog.getByRole('button', { name: 'Confirm' });
    await confirm.focus();
    await page.keyboard.press('Enter');
    await expect(dialog).toBeHidden();
    await expect(row).toHaveCount(0);

    // Nadia can add a job now.
    expect((await nadia.page.goto('/app/jobs/new'))?.status()).toBe(200);
    await expect(nadia.page.getByRole('heading', { level: 1, name: 'Add a job' })).toBeVisible();
    // Scenario: No personal data in URLs
    expect(urls.filter((url) => url.includes(email))).toEqual([]);
    await nadia.context.close();
  });
}

for (const theme of themes) {
  test(`Scenario: The operator rejects with a reason, and the creator sees it (${theme})`, async ({
    browser,
    page,
    baseURL,
  }) => {
    const base = baseURL ?? '';
    const stamp = `${theme}-${Date.now()}`;
    const name = `Turned Away ${stamp}`;
    const creator = await signUpWorkspace(browser, base, `nadia+reject-${stamp}@example.com`, name);
    await creator.context.addCookies([{ name: 'theme', value: theme, url: base }]);
    await signIn(page, { email: PIA });
    await page.goto('/ops/approvals');
    await approvalRow(page, name)
      .getByRole('button', { name: `Reject ${name}` })
      .click();
    const dialog = page.getByRole('dialog', { name: `Reject ${name}?` });
    const confirm = dialog.getByRole('button', { name: 'Confirm' });
    await expect(confirm).toBeDisabled();
    await dialog.getByRole('textbox', { name: 'Reason' }).fill('Too short');
    await expect(confirm).toBeDisabled();
    await dialog.getByRole('textbox', { name: 'Reason' }).fill("Outside the pilot's agreed teams");
    await confirm.click();
    await expect(dialog).toBeHidden();
    await expect(approvalRow(page, name)).toHaveCount(0);

    await creator.page.goto('/app/jobs');
    await expect(
      creator.page.getByRole('heading', { level: 1, name: 'Your workspace was not approved' }),
    ).toBeVisible();
    await expect(
      creator.page.getByText("Your workspace was not approved. Reason: Outside the pilot's agreed teams"),
    ).toBeVisible();
    await expect(creator.page.locator('html')).toHaveAttribute('data-theme', theme);
    await expectNoAxeViolations(creator.page);
    await creator.context.close();
  });
}

test('Scenario: Changing the switch: the preview says pending workspaces stay pending, and Cancel changes nothing', async ({
  page,
}) => {
  await signIn(page, { email: PIA });
  await page.goto('/ops/approvals');
  await expect(page.getByRole('heading', { level: 2, name: 'New workspaces need approval' })).toBeVisible();
  await expect(page.getByText('On', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Turn off' }).click();
  const dialog = page.getByRole('dialog', { name: 'Turn off approval for new workspaces?' });
  await expect(dialog).toContainText('Workspaces already waiting stay waiting until you decide each one.');
  await expect(dialog.getByRole('button', { name: 'Confirm' })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('button', { name: 'Turn off' })).toBeVisible();
});
