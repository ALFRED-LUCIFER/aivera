import { createAssessment } from '@credalent/assessment/composition';
import { createAudit } from '@credalent/audit/composition';
import { createCandidates, displayNamesInWorkspace } from '@credalent/candidates/composition';
import { createDb } from '@credalent/db/client';
import { createEvidence } from '@credalent/evidence/composition';
import { createCandidateJobResolver, createIntake, findApplication } from '@credalent/intake/composition';
import { createInterviews } from '@credalent/interviews/composition';
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

// AIV-P2-006, the J3 step after the score preview: submitting the Round 1 scorecard applies the previewed change and
// logs it. A workspace of its own, set up as score-preview.spec.ts sets up its own: one Daniel Novak per theme,
// assessed from real evidence at 55, with "Retrieval and evaluation" resting on a CV claim, and a Round 1 interview
// with no suggested questions. The numbers are the assessment's own (Clearly shown adds Medium evidence: 55 to 67), not
// the ticket's illustrative 61. The seeded "Demo" interview is never submitted here: other specs read it open.
let creator: string;
let workspaceId: string;
const interviewOf = new Map<string, string>();
const NOTE = 'Walked through the 200-question set he built';

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
  creator = `alex+submit-${stamp}@example.com`;
  const made = await approvedWorkspace(creator, `Submit ${stamp}`);
  workspaceId = made.workspaceId;
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
    const interviews = createInterviews(workspaces, jobs, approvedRubric, findApplication);
    await workspaces.withWorkspace({ userId: made.creatorUserId }, workspaceId, async (ctx) => {
      const job = await jobs.createJob(ctx, {
        title: 'Senior AI Engineer',
        jobType: 'ai_llm_engineering',
        description: 'Senior AI Engineer, synthetic e2e job for the scorecard submit.',
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
      const rubric = await approvedRubric(ctx.tx, workspaceId, job.id);
      if (!rubric) throw new Error('The rubric was not approved.');
      const idOf = (name: string) => rubric.competencies.find((c) => c.name === name)?.id ?? '';
      for (const [i, theme] of themes.entries()) {
        const { personId, applicationId } = await receiveConfirmed(intake, ctx, {
          jobId: job.id,
          person: {
            displayName: `Daniel Novak ${theme}`,
            identifiers: [{ type: 'cv_hash', value: `${stamp}${i}`.padStart(64, '0') }],
            synthetic: true,
          },
          source: 'linkedin',
          fileIds: [crypto.randomUUID()],
        });
        for (const [competencyName, level, kind] of [
          ['Python service engineering', 5, 'repository'],
          ['Retrieval and evaluation', 4, 'cv'],
        ] as const)
          await evidence.recordEvidence(ctx, {
            candidateId: personId,
            source: {
              kind,
              label: kind === 'cv' ? 'CV' : 'rag-service',
              url: kind === 'cv' ? null : 'https://code.credalent.example/daniel/rag-service',
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
        const { interviewId } = await interviews.createInterview(ctx, {
          applicationId,
          round: 'structured_screen',
          interviewerUserId: made.creatorUserId,
          competencyIds: [idOf('Retrieval and evaluation'), idOf('Cost and reliability')],
        });
        interviewOf.set(theme, interviewId);
      }
    });
  } finally {
    await db.$client.end();
  }
});

const effect = (page: Page) =>
  page.getByRole('heading', { level: 2, name: 'Effect on the assessment' }).locator('xpath=..');
const card = (page: Page, name: string) => page.getByRole('region', { name: new RegExp(`^${name}`) });
/** The submit's server action carries the preview id; the preview's carries ratings, the autosave a draft. */
const isSubmit = (body: string | null) => (body ?? '').includes('"previewId"');

for (const theme of themes) {
  test(`Scenario: Submitting applies the change, by keyboard, after a failed try, axe clean (${theme})`, async ({
    page,
    context,
    baseURL,
  }) => {
    await context.addCookies([{ name: 'theme', value: theme, url: baseURL ?? '' }]);
    await signIn(page, { email: creator });
    await page.goto(`/app/interviews/${interviewOf.get(theme)}`);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);

    // AIV-P1-165 §12, plain words: "Round 1", and a notes placeholder that says what to write.
    await expect(page.getByRole('list', { name: 'Interview rounds' })).toContainText('Round 1Current round');
    await expect(page.locator('#content')).not.toContainText(/structured screen|evidence defence|panel/i);
    await expect(card(page, 'Retrieval and evaluation').getByLabel('What you saw or heard')).toHaveAttribute(
      'placeholder',
      'What the candidate said or did',
    );

    // Scenario: Rate only what was tested (AIV-P1-165 §12). With nothing rated, the scorecard says nothing yet.
    const submit = page.getByRole('button', { name: 'Submit scorecard' });
    const rateOne = page.getByText(
      'Rate at least one competency before submitting, or mark its questions Not asked or Not answered. Leave the rest unrated: they stay gaps.',
    );
    // A click before the page hydrates is lost, so it is repeated until the form answers.
    await expect(async () => {
      await submit.focus();
      await page.keyboard.press('Enter');
      await expect(rateOne).toBeVisible({ timeout: 1000 });
    }).toPass();
    await expectAccessible(page);

    // Rate one competency by keyboard, with the note; "Cost and reliability" is left unrated, so it stays a gap.
    const radio = page
      .getByRole('radiogroup', { name: /^Your assessment ?: Retrieval and evaluation$/ })
      .getByRole('radio', { name: 'Clearly shown' });
    await radio.focus();
    await page.keyboard.press('Space');
    await card(page, 'Retrieval and evaluation').getByLabel('What you saw or heard').fill(NOTE);
    await expect(effect(page).locator('[aria-live="polite"]')).toHaveText('Backed score 55 to 67.');
    await expect(rateOne).toHaveCount(0);
    await expect(
      page.getByRole('radiogroup', { name: /^Your assessment ?: Cost and reliability$/ }).getByRole('radio', {
        checked: true,
      }),
    ).toHaveCount(0);
    const notRecommended = page
      .getByRole('radiogroup', { name: 'Next-stage recommendation' })
      .getByRole('radio', { name: 'Do not recommend for Round 2' });
    // Its autosave runs a moment later and disables Submit while it saves: the submit below waits for it to land.
    const recommendationSaved = page.waitForResponse((r) => {
      const body = r.request().postData() ?? '';
      return body.includes('"draft"') && body.includes('not_recommended');
    });
    await notRecommended.focus();
    await page.keyboard.press('Space');
    await expect(effect(page).locator('[aria-live="polite"]')).toHaveText('Backed score 55 to 67.');

    // Scenario: Failure leaves nothing half done: the submit never reaches the server.
    await page.route('**/*', (route) =>
      route.request().method() === 'POST' && isSubmit(route.request().postData()) ? route.abort() : route.fallback(),
    );
    await recommendationSaved;
    await expect(submit).toBeEnabled();
    await submit.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByText('Not submitted. Your ratings are saved. Try again.')).toBeVisible();
    await expect(submit).toBeEnabled();
    // Its fade back from disabled reads as low contrast to axe until it ends.
    await submit.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
    await expectAccessible(page);

    // Scenario: Submitting applies the change: tried again.
    await page.unrouteAll();
    await submit.focus();
    await page.keyboard.press('Enter');
    // The artboard's ok note: a status region with its tick, its words and "See the ranking" inline.
    const confirmed = page
      .getByRole('status')
      .filter({ hasText: `Scorecard submitted and logged. Daniel Novak ${theme}'s assessment has been updated.` });
    await expect(confirmed).toBeVisible();
    await expect(confirmed.getByRole('link', { name: 'See the ranking' })).toBeVisible();
    await expect(page.getByText('This scorecard is submitted. It can no longer change.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Submit scorecard' })).toHaveCount(0);
    await expectAccessible(page);

    // The ranking reads the new snapshot; "Do not recommend" changed no stage and he is still listed.
    await confirmed.getByRole('link', { name: 'See the ranking' }).click();
    const row = page
      .getByRole('table', { name: 'Ranked candidates' })
      .getByRole('row')
      .filter({ hasText: `Daniel Novak ${theme}` });
    await expect(row).toContainText('67');
    // The submit completes the round (AIV-P2-007 shows it) and changes no intake stage: the recommendation moves nobody.
    await expect(row).toContainText('Round 1 complete');
  });
}
