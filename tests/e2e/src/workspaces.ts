import { expect, type Browser, type Page } from '@playwright/test';
import { signIn } from './auth.ts';

// Helpers for specs that sign up a fresh workspace through the app (AIV-P1-001) and decide it in the operator console
// (AIV-P2-039). While "New workspaces need approval" is on (the default, migration ops 0001), a sign-up waits.

export const PIA = 'pia.platform@example.com';
export const WAITING =
  'Your workspace is waiting for approval. We will email you when it is ready, usually within one working day.';

/** A new synthetic address signs in, creates workspace `name` and lands on its waiting page; its own browser context. */
export async function signUpWorkspace(browser: Browser, baseURL: string, email: string, name: string) {
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();
  await signIn(page, { email });
  await page.getByLabel('Company').fill(name);
  await page.getByLabel('What do you hire for most?').selectOption({ label: 'AI and LLM engineering' });
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByText(WAITING)).toBeVisible();
  return { page, context };
}

/** The workspace's row on /ops/approvals; `page` must be signed in as an operator. */
export const approvalRow = (page: Page, name: string) =>
  page.getByRole('table', { name: 'Workspaces waiting for approval' }).getByRole('row').filter({ hasText: name });

/** Pia approves workspace `name` on /ops/approvals, in a browser context of her own. */
export async function approveAsOperator(browser: Browser, baseURL: string, name: string) {
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();
  await signIn(page, { email: PIA });
  await page.goto('/ops/approvals');
  await approvalRow(page, name)
    .getByRole('button', { name: `Approve ${name}` })
    .click();
  const dialog = page.getByRole('dialog', { name: `Approve ${name}?` });
  await dialog.getByRole('button', { name: 'Confirm' }).click();
  // The open dialog hides the page from the accessibility tree, so wait for it to close before counting rows.
  await expect(dialog).toBeHidden();
  await expect(approvalRow(page, name)).toHaveCount(0);
  await context.close();
}
