import { expect, test, type Page } from '@playwright/test';
import { signIn } from './auth.ts';
import { expectAccessible, themes } from './gallery.ts';

// AIV-P1-084 (ADR-014): My desk's "Rubrics to approve". Nadia Freelance (a one-person workspace, seed.ts) sees the
// draft she just saved, opens it from the keyboard, approves it, and it leaves the list. A hiring owner never sees the
// section. Drafting answers from tests/e2e/ai-fixtures.json (senior-ai-engineer). The query, roles and row-level
// security are in tests/integration jobs.test.ts.

const DESCRIPTION =
  'You will ship and run LLM assistants and retrieval systems that real merchants use every day. You will build ' +
  'the eval sets and retrieval metrics that decide what we ship. You will write production Python services, with ' +
  'tests, and deploy them yourself. You keep latency, cost per request and incidents in check. ' +
  'The assistant answers merchants in Arabic and English.';

async function saveDraft(page: Page, title: string) {
  await page.goto('/app/jobs/new');
  await page.getByLabel('Job type').selectOption({ label: 'AI and LLM engineering' });
  await page.getByLabel('Job title').fill(title);
  await page.getByLabel('Job description').fill(DESCRIPTION);
  await page.getByRole('button', { name: 'Draft competencies' }).click();
  await expect(page.getByText('Weights total 100%')).toBeVisible();
  await page.getByRole('button', { name: 'Save job and rubric' }).click();
  await expect(page.getByText(/^Job saved\./)).toBeFocused();
}

for (const theme of themes) {
  test(`Scenario: A solo recruiter approves a draft from My desk, from the keyboard (${theme})`, async ({
    page,
    context,
    baseURL,
  }) => {
    await context.addCookies([{ name: 'theme', value: theme, url: baseURL ?? '' }]);
    await signIn(page, { email: 'nadia@example.com' });
    await page.waitForURL(/\/app/);
    const title = `Desk AI Engineer ${theme} ${Date.now()}`;
    await saveDraft(page, title);

    await page.goto('/app');
    await expect(page.getByRole('heading', { level: 2, name: 'Rubrics to approve' })).toBeVisible();
    await expect(page.getByText(`${title}, version 1.`)).toBeVisible();
    await expectAccessible(page);

    // SAFETY: mutation check: hid DeskToApprove on the desk page (dropped the `desk.toApprove &&` card) -> this test
    // failed (no "Rubrics to approve" heading)
    // Tab through the page to the row's link, which shows a focus ring, then open it with Enter.
    const open = page.getByRole('link', { name: `Open the ${title} rubric` });
    for (let i = 0; i < 80 && !(await open.evaluate((el) => el === document.activeElement)); i++)
      await page.keyboard.press('Tab');
    await expect(open).toBeFocused();
    expect(await open.evaluate((el) => getComputedStyle(el).outlineStyle)).not.toBe('none');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/app\/jobs\/[0-9a-f-]+\/rubric$/);
    await page.getByRole('button', { name: 'Approve version 1' }).click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Version 1 is approved. Assessment can now start for this job.' }),
    ).toBeVisible();

    await page.goto('/app');
    await expect(page.getByText(`${title}, version 1.`)).toHaveCount(0);
  });
}

test('Scenario Outline: Only members who may approve see the section (hiring owner)', async ({ page }) => {
  await signIn(page, { email: 'hana.owner@example.com' });
  await page.waitForURL(/\/app/);
  // My desk needs the recruiter capability (navigation.ts), so a hiring owner never reaches the section at all.
  await page.goto('/app');
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: 'My desk' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Rubrics to approve' })).toHaveCount(0);
});
