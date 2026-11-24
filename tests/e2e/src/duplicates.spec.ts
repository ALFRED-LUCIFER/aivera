import { createAudit } from '@credalent/audit/composition';
import { createCandidates, displayNamesInWorkspace } from '@credalent/candidates/composition';
import { createDb } from '@credalent/db/client';
import { createEvidenceRecords } from '@credalent/evidence/composition';
import type { Source } from '@credalent/intake';
import { receiveConfirmed } from '../confirmedBatch.ts';
import { applicationRecords, createIntake } from '@credalent/intake/composition';
import { createJobs } from '@credalent/jobs/composition';
import type { Locator } from '@playwright/test';
import type { WorkspaceContext } from '@credalent/workspaces';
import { createWorkspaces } from '@credalent/workspaces/composition';
import { databaseUrl } from '../playwright.config.ts';
import { signIn } from './auth.ts';
import { expect, test } from './csp.ts';
import { expectAccessible, themes } from './gallery.ts';
import { approvedWorkspace } from './workspaces.ts';

// AIV-P1-018: the duplicate prompt, its merge preview and the undo preview on a job's ranking, by keyboard, in light and
// dark. Its own workspace and job (made through the contracts, as seed.ts does), so no seeded job, count or screenshot
// changes: "Omar Alsuwaidi" is a likely duplicate of "Omar Al Suwaidi" (same name, nothing else shared), and Sneha
// Iyer's second record merged into hers automatically when an arrival carried both records' identifiers.
// Nothing is confirmed here, so both themes see the same rows; confirming is proven in Ranking.test.tsx and against
// PostgreSQL in tests/integration/src/duplicates.test.ts.

let creator: string;
let jobId: string;

test.beforeAll(async () => {
  const stamp = Date.now();
  creator = `alex+duplicates-${stamp}@example.com`;
  const { workspaceId, creatorUserId } = await approvedWorkspace(creator, `Duplicates ${stamp}`);
  const db = createDb(databaseUrl, { max: 1 });
  try {
    const audit = createAudit(db);
    const workspaces = createWorkspaces(db, audit);
    const jobs = createJobs(workspaces, audit);
    const candidates = createCandidates(workspaces, undefined, {
      audit,
      applications: applicationRecords,
      evidence: createEvidenceRecords(),
    });
    const intake = createIntake(workspaces, candidates, jobs, displayNamesInWorkspace, audit);
    const as = <T>(fn: (ctx: WorkspaceContext) => Promise<T>) =>
      workspaces.withWorkspace({ userId: creatorUserId }, workspaceId, fn);
    jobId = await as(
      async (ctx) =>
        (
          await jobs.createJob(ctx, {
            title: 'Staff Backend Engineer',
            jobType: 'ai_llm_engineering',
            description: 'Staff Backend Engineer, synthetic e2e job.',
            synthetic: true,
          })
        ).id,
    );
    const arrive = (displayName: string, source: Source, identifiers: { email?: string; cv?: number }) =>
      as((ctx) =>
        receiveConfirmed(intake, ctx, {
          jobId,
          person: {
            displayName,
            identifiers: [
              ...(identifiers.email ? [{ type: 'email' as const, value: identifiers.email }] : []),
              ...(identifiers.cv
                ? [{ type: 'cv_hash' as const, value: identifiers.cv.toString(16).padStart(64, '0') }]
                : []),
            ],
            synthetic: true,
          },
          source,
          fileIds: [crypto.randomUUID()],
        }),
      );
    await arrive('Omar Al Suwaidi', 'linkedin', { cv: 1 });
    await arrive('Omar Alsuwaidi', 'email', { cv: 2 });
    await arrive('Sneha Iyer', 'linkedin', { email: 'sneha.iyer@example.com' });
    await arrive('Sneha Iyer', 'email', { cv: 3 });
    await arrive('Sneha Iyer', 'email', { email: 'sneha.iyer@example.com', cv: 3 });
  } finally {
    await db.$client.end();
  }
});

const row = (table: Locator, text: string) => table.getByRole('row').filter({ hasText: text });

for (const theme of themes) {
  test(`Scenario: A likely duplicate needs a person: "Merge?" previews by keyboard, nothing merges (${theme})`, async ({
    page,
    context,
    baseURL,
  }) => {
    await context.addCookies([{ name: 'theme', value: theme, url: baseURL ?? '' }]);
    await signIn(page, { email: creator });
    await page.goto(`/app/jobs/${jobId}/candidates`);
    await expect(page).toHaveTitle('Staff Backend Engineer: Evidence and ranking · Credalent');
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    const table = page.getByRole('table', { name: 'Ranked candidates' });
    const omar = row(table, 'Omar Alsuwaidi');
    await expect(omar).toContainText('Possible duplicate of Omar Al Suwaidi.');
    // The earlier record would stay, so only the newer one asks.
    await expect(table.getByText(/^Possible duplicate of/)).toHaveCount(1);

    const merge = omar.getByRole('button', { name: 'Merge?' });
    await merge.focus();
    await page.keyboard.press('Enter');
    const card = page.getByRole('dialog', { name: 'Preview: merge Omar Alsuwaidi into Omar Al Suwaidi' });
    await expect(card).toContainText('Same name on both records.');
    await expect(card).toContainText('Omar Al Suwaidi (stays)Staff Backend EngineerStage: NewLinkedIn');
    // Both applied to this job: one application remains, at the survivor's stage.
    await expect(card).toContainText(
      'Omar Alsuwaidi (merged in)Staff Backend EngineerStage: New. Both applied to this job: the applications combine ' +
        'at the stage of the one that stays, New.Email',
    );
    await expect(card).toContainText('Nothing is deleted.');
    await expect(card).toContainText('Nothing changes until you confirm.');
    await expect(card.getByRole('button', { name: 'Merge', exact: true })).toBeDisabled();
    await expectAccessible(page);
    await page.keyboard.press('Escape');
    await expect(card).toBeHidden();
    await expect(merge).toBeFocused();
    await expect(omar).toContainText('Possible duplicate of Omar Al Suwaidi.');
  });

  test(`Scenario: Undo a merge: an admin previews "Undo merge" by keyboard, nothing changes (${theme})`, async ({
    page,
    context,
    baseURL,
  }) => {
    await context.addCookies([{ name: 'theme', value: theme, url: baseURL ?? '' }]);
    await signIn(page, { email: creator });
    await page.goto(`/app/jobs/${jobId}/candidates`);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    const sneha = row(page.getByRole('table', { name: 'Ranked candidates' }), 'Sneha Iyer');
    await expect(sneha).toHaveCount(1);
    await expect(sneha).toContainText('1 duplicate merged');

    const undo = sneha.getByRole('button', { name: 'Undo merge' });
    await undo.focus();
    await page.keyboard.press('Enter');
    const card = page.getByRole('dialog', { name: 'Preview: undo the merge of Sneha Iyer' });
    await expect(card).toContainText('Sneha Iyer becomes a separate candidate again');
    await expect(card).toContainText('Nothing changes until you confirm.');
    await expect(card.getByRole('button', { name: 'Undo merge' })).toBeDisabled();
    // The reason is the next stop after the card's text; typing one enables the undo.
    await card.getByRole('textbox', { name: 'Reason, recorded in the audit log' }).focus();
    await page.keyboard.type('Two different people');
    await expect(card.getByRole('button', { name: 'Undo merge' })).toBeEnabled();
    await expectAccessible(page);
    await page.keyboard.press('Escape');
    await expect(card).toBeHidden();
    await expect(undo).toBeFocused();
    await expect(sneha).toContainText('1 duplicate merged');
  });
}
