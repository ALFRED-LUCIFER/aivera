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
import { sql } from 'drizzle-orm';
import { receiveConfirmed } from '../confirmedBatch.ts';
import { databaseUrl } from '../playwright.config.ts';
import { signIn } from './auth.ts';
import { expect, test } from './csp.ts';
import { expectAccessible, themes } from './gallery.ts';
import { approvedWorkspace, syntheticUser } from './workspaces.ts';

// AIV-P2-010, a step of J3: the recruiter builds a decision pack from the ranking, after a preview, and opens it. This
// spec has a workspace of its own, so a pack changes nothing another spec reads: a Senior AI Engineer job with an
// approved rubric, Sara Al Qahtani, Arjun Menon, Huda Al Mansoori and Daniel Novak assessed from real evidence at 55
// each (the formula's numbers, not the ticket's illustrative 68, 64 and 61), and Maria Santos not yet scored; and an
// interviewer granted the job, who may not see its packs. Serial: the later tests open the pack the first one builds.
test.describe.configure({ mode: 'serial' });

let creator: string;
let interviewer: string;
let jobId: string;
const ASSESSED = ['Sara Al Qahtani', 'Arjun Menon', 'Huda Al Mansoori', 'Daniel Novak'];

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
  creator = `alex+pack-${stamp}@example.com`;
  interviewer = `rami+pack-${stamp}@example.com`;
  const made = await approvedWorkspace(creator, `Pack ${stamp}`);
  const db = createDb(databaseUrl, { max: 1 });
  try {
    const interviewerId = await syntheticUser(db, interviewer);
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
        description: 'Senior AI Engineer, synthetic e2e job for building a decision pack.',
        synthetic: true,
      });
      jobId = job.id;
      await ctx.tx.execute(
        sql`insert into workspaces.member (workspace_id, user_id, role, status)
          values (${made.workspaceId}, ${interviewerId}, 'interviewer', 'active')`,
      );
      await workspaces.grantJobAccess(ctx, { userId: interviewerId, jobId: job.id });
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
      for (const [i, name] of [...ASSESSED, 'Maria Santos'].entries()) {
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
        if (!ASSESSED.includes(name)) continue;
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
  await expect(table.getByRole('checkbox', { name: /^Select / })).toHaveCount(6);
  return table;
}
const bar = (page: Page) => page.getByRole('region', { name: 'Bulk actions' });
const preview = (page: Page) => page.getByRole('region', { name: /^Preview: / });
const row = (page: Page, name: string) =>
  page.getByRole('table', { name: 'Ranked candidates' }).getByRole('row').filter({ hasText: name });
// A click before the page hydrates is lost; check() does nothing once the box is ticked, so it is safe to repeat.
const tick = (page: Page, name: string) =>
  expect(() =>
    page
      .getByRole('table', { name: 'Ranked candidates' })
      .getByRole('checkbox', { name: `Select ${name}` })
      .check({ timeout: 1000 }),
  ).toPass();

test('Scenario: Preview, then add, by keyboard; then add to the existing pack', async ({ page }) => {
  const table = await openRanking(page);
  await table.getByRole('checkbox', { name: 'Select all 5 shown' }).focus();
  for (const name of ['Sara Al Qahtani', 'Arjun Menon', 'Huda Al Mansoori']) {
    const box = table.getByRole('checkbox', { name: `Select ${name}` });
    await expect(async () => {
      await page.keyboard.press('Tab');
      await expect(box).toBeFocused({ timeout: 250 });
    }).toPass();
    await page.keyboard.press('Space');
    await expect(box).toBeChecked();
  }
  await bar(page).getByRole('button', { name: 'Add to decision pack' }).focus();
  await page.keyboard.press('Enter');

  await expect(preview(page).getByRole('heading')).toHaveText('Preview: add 3 candidates to a decision pack');
  await expect(
    preview(page).getByRole('img', { name: /^55 backed by evidence · up to \d+ if claims hold$/ }),
  ).toHaveCount(3);
  await expect(preview(page)).toContainText('Nothing changes until you confirm.');
  await expect(row(page, 'Sara Al Qahtani')).not.toContainText('In shortlist pack');
  // Focus moved into the preview: Tab reaches the pack choice, then its name, then Confirm.
  await page.keyboard.press('Tab');
  await expect(preview(page).getByRole('radio', { name: 'New pack' })).toBeFocused();
  await expect(preview(page).getByRole('radio', { name: 'New pack' })).toBeChecked();
  await page.keyboard.press('Tab');
  await expect(preview(page).getByRole('textbox', { name: 'Pack name' })).toBeFocused();
  await page.keyboard.type('Round 2 shortlist');
  await page.keyboard.press('Tab');
  await expect(preview(page).getByRole('button', { name: 'Add 3 to the pack' })).toBeFocused();
  await page.keyboard.press('Enter');

  await expect(page.getByText('3 candidates added to Round 2 shortlist.')).toBeVisible();
  for (const name of ['Sara Al Qahtani', 'Arjun Menon', 'Huda Al Mansoori'])
    await expect(row(page, name)).toContainText('In shortlist pack');
  // Candidates outside the pack stay visible, unchanged: Daniel at 55, Maria not yet scored.
  for (const name of ['Daniel Novak', 'Maria Santos']) {
    await expect(row(page, name)).toBeVisible();
    await expect(row(page, name)).not.toContainText('In shortlist pack');
  }
  await expect(
    row(page, 'Daniel Novak').getByRole('img', { name: /^55 backed by evidence · up to \d+ if claims hold$/ }),
  ).toBeVisible();
  await expect(row(page, 'Maria Santos')).toContainText('Not yet scored');

  // Add to an existing pack: Daniel joins the undecided one, offered first.
  await tick(page, 'Daniel Novak');
  await bar(page).getByRole('button', { name: 'Add to decision pack' }).click();
  await expect(preview(page).getByRole('radio', { name: 'Round 2 shortlist (3 candidates)' })).toBeChecked();
  await preview(page).getByRole('button', { name: 'Add 1 to the pack' }).click();
  await expect(page.getByText('1 candidate added to Round 2 shortlist.')).toBeVisible();

  await page.getByRole('link', { name: 'Open the pack' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Round 2 shortlist: Senior AI Engineer' })).toBeVisible();
  await expect(page.getByText(/^Decision pack · prepared \d{1,2} [A-Z][a-z]{2} \d{4} · rubric v1$/)).toBeVisible();
  for (const name of ASSESSED) await expect(page.getByRole('link', { name })).toHaveCount(1);
  await expect(
    page.getByText('1 other candidate stays in the ranking and can be added to a later pack.'),
  ).toBeVisible();
  // The Decision stage is current on the pack's page, and its tab lists the pack.
  await expect(page.getByRole('link', { name: /^Decision/ })).toHaveAttribute('aria-current', 'page');
  await page.getByRole('link', { name: /^Decision/ }).click();
  await page.getByRole('link', { name: 'Round 2 shortlist' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Round 2 shortlist: Senior AI Engineer' })).toBeVisible();
  await page.getByRole('link', { name: 'Back to ranking' }).click();
  await expect(page).toHaveTitle('Senior AI Engineer: Evidence and ranking · Credalent');
});

for (const theme of themes) {
  test(`axe passes on the decision pack page (${theme})`, async ({ page, context, baseURL }) => {
    await context.addCookies([{ name: 'theme', value: theme, url: baseURL ?? '' }]);
    await signIn(page, { email: creator });
    await page.goto(`/app/jobs/${jobId}/pack`);
    await page.getByRole('link', { name: 'Round 2 shortlist' }).click();
    await expect(page.getByRole('heading', { level: 2, name: 'Round 2 shortlist: Senior AI Engineer' })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await expectAccessible(page);
  });
}

test('an interviewer granted the job gets the 403 page on its Decision tab, not its packs', async ({ page }) => {
  await signIn(page, { email: interviewer });
  await page.goto(`/app/jobs/${jobId}/pack`);
  await expect(page.getByText('You do not have access to this. Ask your workspace admin.')).toBeVisible();
  await expect(page.getByText('Round 2 shortlist')).toHaveCount(0);
});

for (const theme of themes) {
  test(`axe passes with the pack preview open, and Cancel changes nothing (${theme})`, async ({
    page,
    context,
    baseURL,
  }) => {
    await context.addCookies([{ name: 'theme', value: theme, url: baseURL ?? '' }]);
    await openRanking(page);
    await tick(page, 'Maria Santos');
    await bar(page).getByRole('button', { name: 'Add to decision pack' }).click();
    await expect(preview(page)).toContainText('Not yet scored, so not added');
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await expectAccessible(page);
    await preview(page).getByRole('button', { name: 'Cancel' }).click();
    await expect(preview(page)).toHaveCount(0);
    await expect(row(page, 'Maria Santos')).not.toContainText('In shortlist pack');
  });
}
