import { createAssessment } from '@credalent/assessment/composition';
import { createAudit } from '@credalent/audit/composition';
import { createCandidates, displayNamesInWorkspace } from '@credalent/candidates/composition';
import { createDb } from '@credalent/db/client';
import { withWorkspace } from '@credalent/db/with-workspace';
import { createEvidence } from '@credalent/evidence/composition';
import { createCandidateJobResolver, createIntake, findApplication } from '@credalent/intake/composition';
import { createInterviews } from '@credalent/interviews/composition';
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
import { approvedWorkspace } from './workspaces.ts';

// AIV-P2-005, a step of J3: rating a competency on the scorecard previews how the backed score would move, and applies
// nothing. A workspace of its own, set up as meeting-summary.spec.ts sets up its own: a Senior AI Engineer job with an
// approved rubric and one Daniel Novak per theme, assessed from real evidence at 55, with "Retrieval and evaluation"
// resting on a CV claim stored as Supporting, and a Round 1 interview. The numbers are the assessment's own preview
// (AIV-P1-117), not the ticket's illustrative ones: Clearly and Strongly shown both add Medium evidence (never Strong,
// one interviewer's word is not a second source), 55 to 67; Not shown makes the claim Claim only, and the backed score
// stays 55, since a claim already counts zero.
let creator: string;
let workspaceId: string;
const interviewOf = new Map<string, string>();

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
  creator = `alex+preview-${stamp}@example.com`;
  const made = await approvedWorkspace(creator, `Preview ${stamp}`);
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
        description: 'Senior AI Engineer, synthetic e2e job for the score preview.',
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

/** Every audit entry of the workspace: a preview must add none. */
async function auditEntries() {
  const db = createDb(databaseUrl, { max: 1 });
  try {
    const [row] = await withWorkspace(db, workspaceId, (tx) =>
      tx.execute<{ n: number }>(sql`select count(*)::int as n from audit.entry where workspace_id = ${workspaceId}`),
    );
    return row?.n;
  } finally {
    await db.$client.end();
  }
}

/** Daniel's row on the job's ranking, in a second tab so the interview page keeps its state. */
async function rankedRow(page: Page, theme: string) {
  const tab = await page.context().newPage();
  await tab.goto('/app/jobs');
  await tab.getByRole('link', { name: 'Senior AI Engineer' }).click();
  const row = tab
    .getByRole('table', { name: 'Ranked candidates' })
    .getByRole('row')
    .filter({ hasText: `Daniel Novak ${theme}` });
  await expect(row).toContainText('55up to 71 if claims hold');
  const text = await row.textContent();
  await tab.close();
  return text;
}

const effect = (page: Page) =>
  page.getByRole('heading', { level: 2, name: 'Effect on the assessment' }).locator('xpath=..');
const radio = (page: Page, name: string) =>
  page.getByRole('radiogroup', { name: /^Your assessment ?: Retrieval and evaluation$/ }).getByRole('radio', { name });
/** The preview's server action carries the ratings; the draft's autosave carries a draft. */
const isPreview = (body: string | null) => (body ?? '').includes('"ratings"');

/** The panel's heading, strength line and score line, the score line in the polite live region. */
async function expectEffect(page: Page, heading: string, strength: string, score: string) {
  await expect(effect(page).locator('[aria-live="polite"]')).toHaveText(score);
  await expect(effect(page).getByText(heading, { exact: true })).toBeVisible();
  await expect(effect(page).getByText(strength, { exact: true })).toBeVisible();
}

for (const theme of themes) {
  test(`Scenario Outline: each rating previews its change, by keyboard, applying nothing, axe clean (${theme})`, async ({
    page,
    context,
    baseURL,
  }) => {
    await context.addCookies([{ name: 'theme', value: theme, url: baseURL ?? '' }]);
    await signIn(page, { email: creator });
    const audits = await auditEntries();
    const ranked = await rankedRow(page, theme);
    await page.goto(`/app/interviews/${interviewOf.get(theme)}`);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);

    // Scenario: Before any rating.
    await expect(
      effect(page).getByText(
        'Rate Retrieval and evaluation to preview how the backed score would change. Nothing is applied until you submit.',
      ),
    ).toBeVisible();
    await expect(
      effect(page).getByText('Every change is logged with your name, the time and your note.'),
    ).toBeVisible();
    await expectAccessible(page);

    // Scenario Outline: Rating previews the change, by keyboard: Space rates, the arrow keys move the rating.
    await radio(page, 'Partly shown').focus();
    await page.keyboard.press('Space');
    await expectEffect(page, 'No change', 'Retrieval and evaluation stays at Supporting.', 'Backed score stays 55.');
    await page.keyboard.press('ArrowRight');
    await expectEffect(
      page,
      'Evidence strengthened',
      'Retrieval and evaluation: Supporting to Medium.',
      'Backed score 55 to 67.',
    );
    await expect(effect(page).getByText('Before: Observed')).toBeVisible();
    await expect(effect(page).getByText('After: Projection')).toBeVisible();
    await expectAccessible(page);
    // Strongly shown reads as Clearly shown, so wait for its own answer.
    const strongly = page.waitForResponse(
      (r) => isPreview(r.request().postData()) && /strongly_shown/.test(r.request().postData() ?? ''),
    );
    await page.keyboard.press('ArrowRight');
    await strongly;
    await expectEffect(
      page,
      'Evidence strengthened',
      'Retrieval and evaluation: Supporting to Medium.',
      'Backed score 55 to 67.',
    );
    await page.keyboard.press('ArrowRight');
    await expect(radio(page, 'Not shown')).toBeChecked();
    await expectEffect(
      page,
      'Evidence weakened',
      'Retrieval and evaluation: Supporting to Claim only.',
      'Backed score stays 55.',
    );
    await expectAccessible(page);

    // Scenario: Preview applies nothing: rated Strongly shown, reloaded without submitting.
    const draftSaved = page.waitForResponse(
      (r) => !isPreview(r.request().postData()) && /strongly_shown/.test(r.request().postData() ?? ''),
    );
    await page.keyboard.press('ArrowLeft');
    await expect(radio(page, 'Strongly shown')).toBeChecked();
    await expect(effect(page).locator('[aria-live="polite"]')).toHaveText('Backed score 55 to 67.');
    await draftSaved;
    await page.reload();
    await expect(radio(page, 'Strongly shown')).toBeChecked();
    await expect(page.getByRole('list', { name: 'Interview rounds' })).toContainText('backed score 55');
    expect(await rankedRow(page, theme)).toBe(ranked);
    expect(await auditEntries()).toBe(audits);

    // Scenario: Preview service fails: the rating is kept.
    await page.route('**/*', (route) =>
      route.request().method() === 'POST' && isPreview(route.request().postData()) ? route.abort() : route.fallback(),
    );
    await radio(page, 'Clearly shown').focus();
    await page.keyboard.press('Space');
    await expect(effect(page).locator('[aria-live="polite"]')).toHaveText(
      'Preview unavailable. Your rating is kept and will be applied when you submit.',
    );
    await expect(radio(page, 'Clearly shown')).toBeChecked();
    await expectAccessible(page);
  });
}
