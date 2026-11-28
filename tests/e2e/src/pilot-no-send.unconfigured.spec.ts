import { expect, test } from '@playwright/test';
import { signIn } from './auth.ts';
import { expectAccessible } from './gallery.ts';
import { approvedWorkspace } from './workspaces.ts';

// AIV-P1-165 Scenario Outline: Send actions are off the pilot path, run by the "unconfigured" project: an app with
// OUTBOUND unset, so off, as on dev and in the pilot (playwright.config.ts). This app has no fake model, so the saved
// page's buttons are JobSaved.test.tsx; that the server queues no email and publishes nothing with the buttons gone is
// apps/web/src/server/notifications.test.ts, rubricEmails.test.ts and publishListing.test.ts.

test('Add a job offers no "Invite a hiring owner" to a workspace with no hiring owner', async ({ page }) => {
  const solo = `solo.nosend.${Date.now()}@example.com`;
  await approvedWorkspace(solo, `Solo no send ${Date.now()}`);
  await signIn(page, { email: solo });
  await page.waitForURL(/\/app/);
  await page.goto('/app/jobs/new');
  await expect(page.getByText('This workspace has no hiring owner yet.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Invite a hiring owner' })).toHaveCount(0);
});

// Alex's "Applied AI Engineer" (seed.ts): rubric version 2 approved, with a hiring owner, not published.
test('The rubric page offers no send or publish, in reading and in edit mode', async ({ page }) => {
  await signIn(page, { email: 'alex@example.com' });
  await page.goto('/app/jobs');
  await page.getByRole('link', { name: 'Applied AI Engineer' }).click();
  await page.getByRole('link', { name: /^Competencies and rubric/ }).click();
  await expect(page).toHaveTitle('Applied AI Engineer: Competencies and rubric · Credalent');
  await expect(page.getByRole('heading', { name: 'Publish on Credalent jobs' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Send to the hiring owner' })).toHaveCount(0);
  await expectAccessible(page);

  await page.getByRole('button', { name: 'Edit rubric' }).click();
  await expect(page.getByRole('button', { name: 'Save draft' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send changes for approval' })).toHaveCount(0);
  // Leaves without saving: nothing changes.
  await page.getByRole('button', { name: 'Cancel' }).click();
});

// §16 "Add a job, Invite a hiring owner: the Members invitation": Members says invitations are off instead of offering a
// form that fails on submit (§13: no button that fails silently).
test('Members says invitations are off, with no invite form', async ({ page }) => {
  await signIn(page, { email: 'alex@example.com' });
  await page.goto('/app/settings/members');
  await expect(page.getByRole('heading', { name: 'Invite someone', level: 2 })).toBeVisible();
  await expect(page.getByText('Invitations are off during the pilot: no email leaves Credalent.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send invitation' })).toHaveCount(0);
  await expectAccessible(page);
});
