import { createAssessment } from '@credalent/assessment/composition';
import { createAudit } from '@credalent/audit/composition';
import { createCandidates, displayNamesInWorkspace } from '@credalent/candidates/composition';
import { createDb } from '@credalent/db/client';
import { createEvidence } from '@credalent/evidence/composition';
import { createCandidateJobResolver, createIntake } from '@credalent/intake/composition';
import type { Competency } from '@credalent/jobs';
import { createApprovedRubricReads, createJobs } from '@credalent/jobs/composition';
import { createWorkspaces } from '@credalent/workspaces/composition';
import type { Page } from '@playwright/test';
import { receiveConfirmed } from '../confirmedBatch.ts';
import { databaseUrl } from '../playwright.config.ts';
import { signIn } from './auth.ts';
import { expect, test } from './csp.ts';
import { expectAccessible, themes } from './gallery.ts';
import { approvedWorkspace } from './workspaces.ts';

// AIV-P1-114, a step of J3: the recruiter chooses who to interview from the ranking, after a preview, and finds them on
// the Interviews page. This spec has a workspace of its own, so a confirmed choice moves nobody another spec reads: a
// Senior AI Engineer job with an approved rubric, Daniel Novak and Priya Nair assessed from real evidence at 55 (their
// gaps: Cost and reliability, unproven; Retrieval and evaluation, a claim), and Omar Al Suwaidi and Maria Santos not
// yet scored. The scores follow the scoring formula, not the ticket's illustrative 55 and 49.

let creator: string;

const competency = (name: string, weightPercent: number, levelNeeded: number): Competency => ({
  name,
  evidenceExpected: `Evidence of ${name.toLowerCase()}`,
  weightPercent,
  levelNeeded,
  type: 'mandatory',
  origin: 'from_description',
});

test.beforeAll(async () => {
  const stamp = Date.now();
  creator = `alex+choose-${stamp}@example.com`;
  const made = await approvedWorkspace(creator, `Choose ${stamp}`);
  const db = createDb(databaseUrl, { max: 1 });
  try {
    const audit = createAudit(db);
    const workspaces = createWorkspaces(db, audit);
    const jobs = createJobs(workspaces, audit);
    const applied = createCandidateJobResolver(jobs);
    const intake = createIntake(workspaces, createCandidates(workspaces), jobs, displayNamesInWorkspace, audit);
    const evidence = createEvidence(workspaces, audit, undefined, applied);
    const assessment = createAssessment(workspaces, audit, jobs, undefined, applied);
    const { approvedRubric } = createApprovedRubricReads();
    await workspaces.withWorkspace({ userId: made.creatorUserId }, made.workspaceId, async (ctx) => {
      const job = await jobs.createJob(ctx, {
        title: 'Senior AI Engineer',
        jobType: 'ai_llm_engineering',
        description: 'Senior AI Engineer, synthetic e2e job for choosing who to interview.',
        synthetic: true,
      });
      const saved = await jobs.saveRubric(ctx, job.id, {
        successStatement: 'Ships reliable AI features.',
        competencies: [
          competency('Python service engineering', 55, 4),
          competency('Retrieval and evaluation', 20, 3),
          competency('Cost and reliability', 25, 3),
        ],
      });
      const sent = await jobs.submitRubric(ctx, saved.id);
      await jobs.approveRubric(ctx, sent.id, sent.revision);
      const rubric = await approvedRubric(ctx.tx, made.workspaceId, job.id);
      if (!rubric) throw new Error('The rubric was not approved.');
      const idOf = (name: string) => rubric.competencies.find((c) => c.name === name)?.id ?? '';
      for (const [i, name] of ['Daniel Novak', 'Priya Nair', 'Omar Al Suwaidi', 'Maria Santos'].entries()) {
        const { personId } = await receiveConfirmed(intake, ctx, {
          jobId: job.id,
          person: {
            displayName: name,
            identifiers: [{ type: 'cv_hash', value: `${stamp}${i}`.padStart(64, '0') }],
            synthetic: true,
          },
          source: 'linkedin',
          fileIds: [crypto.randomUUID()],
        });
        if (i > 1) continue;
        for (const [competencyName, level, kind] of [
          ['Python service engineering', 5, 'repository'],
          ['Retrieval and evaluation', 4, 'cv'],
        ] as const)
          await evidence.recordEvidence(ctx, {
            candidateId: personId,
            source: {
              kind,
              label: kind === 'cv' ? 'CV' : 'rag-service',
              url: kind === 'cv' ? null : 'https://code.credalent.example/candidate/rag-service',
              blobFileId: null,
              capturedAt: new Date('2026-11-10T08:00:00.000Z'),
              checkedAt: kind === 'cv' ? null : new Date('2026-11-12T08:00:00.000Z'),
              checkMethod: kind === 'cv' ? null : 'Commit history',
            },
            items: [
              {
                excerpt: kind === 'cv' ? 'raised answer accuracy from 71% to 88%' : 'authored 301 of 340 commits',
                excerptSpan: null,
                provenance: kind === 'cv' ? 'claim' : 'corroborated',
                strength: kind === 'cv' ? 'supporting' : 'strong',
                limit: kind === 'cv' ? 'A claim until a second source supports it.' : 'Shows the code, not its use.',
                competencies: [{ jobId: job.id, competencyId: idOf(competencyName), level }],
              },
            ],
            synthetic: true,
          });
        const snapshot = await assessment.assessCandidate(ctx, {
          candidateId: personId,
          jobId: job.id,
          rubric: { versionId: rubric.id, competencies: rubric.competencies },
          evidence: await evidence.listEvidenceForCandidate(ctx, personId, job.id),
        });
        if (snapshot.backedScore !== 55) throw new Error(`Expected a backed score of 55, got ${snapshot.backedScore}.`);
      }
    });
  } finally {
    await db.$client.end();
  }
});

async function openRanking(page: Page) {
  await signIn(page, { email: creator });
  await page.goto('/app/jobs');
  await page.getByRole('link', { name: 'Senior AI Engineer' }).click();
  await expect(page).toHaveTitle('Senior AI Engineer: Evidence and ranking · Credalent');
  const table = page.getByRole('table', { name: 'Ranked candidates' });
  // The rows have streamed in, so focus stays where it is put.
  await expect(table.getByRole('checkbox', { name: /^Select / })).toHaveCount(5);
  return table;
}
const bar = (page: Page) => page.getByRole('region', { name: 'Bulk actions' });
const preview = (page: Page) => page.getByRole('region', { name: /^Preview: / });

test('Scenario: Preview, then confirm, by keyboard', async ({ page }) => {
  const table = await openRanking(page);
  await table.getByRole('checkbox', { name: 'Select all 4 shown' }).focus();
  for (const name of ['Daniel Novak', 'Priya Nair']) {
    const box = table.getByRole('checkbox', { name: `Select ${name}` });
    await expect(async () => {
      await page.keyboard.press('Tab');
      await expect(box).toBeFocused({ timeout: 250 });
    }).toPass();
    await page.keyboard.press('Space');
    await expect(box).toBeChecked();
  }
  await bar(page).getByRole('button', { name: 'Choose for interview' }).focus();
  await page.keyboard.press('Enter');

  await expect(preview(page).getByRole('heading')).toHaveText('Preview: 2 people chosen for interview');
  await expect(preview(page)).toContainText('Nothing changes until you confirm.');
  for (const name of ['Daniel Novak', 'Priya Nair']) {
    const person = preview(page).getByRole('listitem').filter({ hasText: name });
    await expect(person.getByRole('img', { name: /^55 backed by evidence · up to \d+ if claims hold$/ })).toBeVisible();
    await expect(person).toContainText('To investigate: Cost and reliability; Retrieval and evaluation');
  }
  await expect(preview(page)).toContainText('Round 1, structured screen');
  await expect(preview(page)).toContainText('Interviewer: You');
  // Focus moved into the preview, on the reason, prefilled.
  const reason = preview(page).getByRole('textbox', { name: 'Reason' });
  await expect(reason).toBeFocused();
  await expect(reason).toHaveValue('First shortlist');
  // Nothing has changed yet.
  await expect(table.getByRole('row').filter({ hasText: 'Daniel Novak' })).not.toContainText('Chosen for interview');

  await page.keyboard.press('Tab');
  await expect(preview(page).getByRole('button', { name: 'Choose 2 for interview' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(
    page.getByText('2 people chosen for interview. They are on the Interviews page, not scheduled yet.'),
  ).toBeVisible();
  for (const name of ['Daniel Novak', 'Priya Nair'])
    await expect(table.getByRole('row').filter({ hasText: name })).toContainText('Chosen for interview');
  // Everyone else stays in the ranking, unchanged.
  for (const name of ['Omar Al Suwaidi', 'Maria Santos'])
    await expect(table.getByRole('row').filter({ hasText: name })).not.toContainText('Chosen for interview');

  await page.goto('/app/interviews');
  const interviews = page.getByRole('table', { name: 'Interviews' });
  for (const name of ['Daniel Novak', 'Priya Nair']) {
    const row = interviews.getByRole('row').filter({ hasText: name });
    await expect(row).toContainText('Round 1, structured screen');
    await expect(row).toContainText('Not scheduled yet');
  }
  await expect(interviews.getByRole('row').filter({ hasText: 'Omar Al Suwaidi' })).toHaveCount(0);
});

for (const theme of themes) {
  test(`axe passes with the choose preview open, and Cancel changes nothing (${theme})`, async ({
    page,
    context,
    baseURL,
  }) => {
    await context.addCookies([{ name: 'theme', value: theme, url: baseURL ?? '' }]);
    const table = await openRanking(page);
    // A click before the page hydrates is lost; check() does nothing once the box is ticked, so it is safe to repeat.
    await expect(() =>
      table.getByRole('checkbox', { name: 'Select Omar Al Suwaidi' }).check({ timeout: 1000 }),
    ).toPass();
    await bar(page).getByRole('button', { name: 'Choose for interview' }).click();
    await expect(preview(page)).toContainText('Omar Al SuwaidiNot yet scored');
    await expect(preview(page)).not.toContainText('No evidence gap');
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await expectAccessible(page);
    await preview(page).getByRole('textbox', { name: 'Reason' }).fill('');
    await expect(preview(page)).toContainText('Give a reason for this choice');
    await expect(preview(page).getByRole('button', { name: 'Choose 1 for interview' })).toBeDisabled();
    await expectAccessible(page);
    await preview(page).getByRole('button', { name: 'Cancel' }).click();
    await expect(preview(page)).toHaveCount(0);
    await expect(table.getByRole('row').filter({ hasText: 'Omar Al Suwaidi' })).not.toContainText(
      'Chosen for interview',
    );
  });
}
