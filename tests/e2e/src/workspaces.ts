import { createAudit } from '@credalent/audit/composition';
import { createDb } from '@credalent/db/client';
import { createIdentity } from '@credalent/identity/composition';
import { createWorkspaces } from '@credalent/workspaces/composition';
import { expect, type Browser, type Page } from '@playwright/test';
import { databaseUrl } from '../playwright.config.ts';
import { signIn } from './auth.ts';

// Helpers for specs that sign up a fresh workspace through the app (AIV-P1-001) and decide it in the operator console
// (AIV-P2-039), or make one approved through the contracts. While "New workspaces need approval" is on (the default,
// migration ops 0001), a sign-up waits.

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

/**
 * Workspace `name`, signed up by `creatorEmail` and approved by Pia, made through the modules' contracts as seed.ts
 * makes the cast. Through the screens, the sign-up and the approval took half of a 30 s spec on a CI runner;
 * ops-approvals.spec.ts proves those screens. The creator lands in it on sign-in.
 */
export async function approvedWorkspace(creatorEmail: string, name: string): Promise<void> {
  const db = createDb(databaseUrl, { max: 1 });
  try {
    const identity = createIdentity(db, { trustedIssuer: 'e2e-seed' });
    const workspaces = createWorkspaces(db, createAudit(db));
    // Named as the mocked tenant names people (the email's local part), so a later sign-in renames nobody.
    const person = async (email: string) =>
      (
        await identity.upsertUserFromIdToken({
          issuer: 'e2e-seed',
          subject: email,
          email,
          emailVerified: true,
          displayName: email.slice(0, email.indexOf('@')),
        })
      ).id;
    const { id } = await workspaces.createWorkspace({
      name,
      company: name,
      hiringFocus: 'AI and LLM engineering',
      synthetic: true,
      needsApproval: true,
      creatorUserId: await person(creatorEmail),
    });
    await workspaces.changeStatus({ operatorId: await person(PIA), workspaceId: id, change: 'approve', reason: '' });
  } finally {
    await db.$client.end();
  }
}
