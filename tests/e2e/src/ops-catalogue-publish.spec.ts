import { createDb } from '@credalent/db/client';
import { expect, test, type Page } from '@playwright/test';
import { sql } from 'drizzle-orm';
import { databaseUrl } from '../playwright.config.ts';
import { signIn } from './auth.ts';
import { expectAccessible } from './gallery.ts';

// AIV-P2-049 J0: Pia Platform reviews a catalogue draft's diff, meets the publish gate and publishes version 2; Mira then
// gets the new pack in Add a job. A published version is permanent and every recruiter spec reads the catalogue, so this
// is its own project (playwright.config.ts): after the gallery locally, on its own database in CI. Locally it publishes
// only with E2E_PUBLISH_CATALOGUE=1, so a shared local database keeps version 1. The preview, the eval copy that the
// gallery's draft reaches and Discard are ops-catalogue.spec.ts; the gate, the race and the audit are
// tests/integration catalogue-publish.test.ts. Synthetic people and catalogue text only.

test.skip(!process.env['CI'] && !process.env['E2E_PUBLISH_CATALOGUE'], 'publishes a permanent catalogue version');

const REASON = 'Add insurance pack for the pilot client';

/** Ends the running eval run as the worker would (no worker runs in e2e; it is tested in tests/integration). */
const finish = async (status: 'passed' | 'failed') => {
  const db = createDb(databaseUrl, { max: 1 });
  try {
    await db.execute(sql`update jobs.catalogue_eval_run set status = ${status}, finished_at = now(), tokens = 1200,
      result = '{"uncovered":[],"tasks":[]}'::jsonb where status = 'running'`);
  } finally {
    await db.$client.end();
  }
};
const runEval = async (page: Page, status: 'passed' | 'failed') => {
  await page.getByRole('button', { name: 'Run the eval' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Eval running…' })).toBeVisible();
  await finish(status);
  await page.reload();
};
const preview = (page: Page) => page.getByRole('dialog', { name: 'Publish catalogue version 2' });
/** Opens the preview, checks what it says and that Publish is disabled, and closes it. */
async function blocked(page: Page, copy: string) {
  await page.getByRole('button', { name: 'Review and publish' }).click();
  await expect(preview(page)).toContainText(copy);
  await expect(preview(page).getByRole('button', { name: 'Publish version 2' })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(preview(page)).toBeHidden();
}

test('Scenarios: the gate, publish with a reason, the audit row, and the new pack in Add a job', async ({ page }) => {
  await signIn(page, { email: 'pia.platform@example.com' });
  await page.goto('/ops/catalogue');
  await page.getByRole('button', { name: 'Start a draft' }).click();
  await page.getByRole('button', { name: 'Add a pack' }).click();
  const packDialog = page.getByRole('dialog', { name: 'Add a pack' });
  await packDialog.getByLabel('Key').fill('insurance');
  await packDialog.getByLabel('English label').fill('Insurance and insurtech');
  await packDialog.getByRole('button', { name: 'Save' }).click();
  await expect(packDialog).toBeHidden();

  // Scenario Outline: Publish stays disabled until the gate is met.
  await blocked(page, 'Run the eval before publishing.');
  await runEval(page, 'failed');
  await blocked(page, 'The last eval run failed. Fix the draft and run it again.');
  await runEval(page, 'passed');
  await page.locator('main summary').filter({ hasText: 'Telecom' }).first().click();
  await page.getByRole('button', { name: 'Edit Telecom' }).click();
  const edit = page.getByRole('dialog', { name: 'Edit pack' });
  await edit.getByLabel('English label').fill('Telecom and 5G');
  await edit.getByRole('button', { name: 'Save' }).click();
  await expect(edit).toBeHidden();
  await blocked(page, 'The draft changed after the last eval run. Run it again.');
  await runEval(page, 'passed');

  // Scenario: Publishing needs a passed eval and a reason, from the keyboard.
  await page.getByRole('button', { name: 'Review and publish' }).focus();
  await page.keyboard.press('Enter');
  const card = preview(page);
  await expect(card.getByRole('listitem').filter({ hasText: 'Added: Insurance and insurtech' })).toHaveCount(1);
  await expect(
    card.getByRole('listitem').filter({ hasText: 'Edited: Telecom label, Telecom → Telecom and 5G' }),
  ).toHaveCount(1);
  await card.getByLabel('Reason').fill('Add it');
  await expect(card).toContainText('Write a reason of at least 10 characters.');
  await expect(card.getByRole('button', { name: 'Publish version 2' })).toBeDisabled();
  await card.getByLabel('Reason').fill(REASON);
  await expectAccessible(page);
  await card.getByRole('button', { name: 'Publish version 2' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByText('Recruiters see version 2. Start a draft to change it.')).toBeVisible();

  // Scenario: A catalogue publish appears in the platform audit log (AIV-P2-054).
  await page.goto('/ops/audit?action=catalogue.published');
  const row = page.getByRole('row').filter({ hasText: 'Catalogue published' });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('pia.platform');
  await expect(row).toContainText('Catalogue version 2');
  await expect(row).toContainText(REASON);
  await expect(row).toContainText(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}/);

  // Mira's Add a job offers the new pack on her next request.
  await page.context().clearCookies();
  await signIn(page, { email: 'mira@example.com' });
  await page.goto('/app/jobs/new');
  await page.getByLabel('Job type').selectOption({ label: 'Software engineering' });
  await page.getByLabel('Job title').fill(`Studio Tools Engineer ${Date.now()}`);
  await page.getByLabel('Location').fill('Al Quoz studio');
  await page
    .getByLabel('Job description')
    .fill('You will build the internal tools our studio team uses to plan their week.');
  await page.getByRole('button', { name: 'Draft competencies' }).click();
  await page.getByText('Add industry skills').click();
  const packs = page.getByRole('list', { name: 'Industries' }).getByRole('button');
  await expect(packs.filter({ hasText: 'Insurance and insurtech' })).toHaveCount(1);
  await expect(packs.filter({ hasText: 'Telecom and 5G' })).toHaveCount(1);
});
