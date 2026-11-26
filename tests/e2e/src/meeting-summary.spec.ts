import { join } from 'node:path';
import { createAiClient, memoryTokenBudget, providerFromEnv } from '@credalent/ai';
import { createAssessment } from '@credalent/assessment/composition';
import { createAudit } from '@credalent/audit/composition';
import { createCandidates, displayNamesInWorkspace, readPersonAsSystem } from '@credalent/candidates/composition';
import { createDb } from '@credalent/db/client';
import { createConsumer } from '@credalent/db/consumer';
import { withWorkspace } from '@credalent/db/with-workspace';
import { createEvidence } from '@credalent/evidence/composition';
import { createCandidateJobResolver, createIntake, findApplication } from '@credalent/intake/composition';
import { createInterviews, createSummaryHandlers, SUMMARY_QUEUE } from '@credalent/interviews/composition';
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

// AIV-P1-115, a step of J3: a pasted meeting summary becomes proposed evidence changes the recruiter confirms.
// This spec has a workspace of its own, so applying a change moves no score another spec reads: a Senior AI Engineer
// job with an approved rubric and one Daniel Novak per theme, each assessed from real evidence at 55 (the seeded Daniel
// of "Demo" has hand-written scores, which the assessment's preview refuses as not yet scored) with a Round 1
// interview. The numbers follow the scoring formula: 55 to 67 here, not the artboard's illustrative 55 to 61.
// The e2e run starts no worker, so `analyse` below plays it: it delivers the page's own MeetingSummarySubmitted.v1 from
// the outbox to the worker's real consumer and handler, with the model stubbed at the port (ai-fixtures.json).
const SUMMARY = 'Daniel walked through the 200-question evaluation set he built and showed how answers were graded.';
const QUOTE = 'walked through the 200-question evaluation set he built';
// AIV-P1-138: a summary whose finding lowers the evidence (Not shown to Claim only).
const LOWERING = 'Daniel could not explain how the 200-question set was graded and said a colleague built it.';

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
  creator = `alex+summary-${stamp}@example.com`;
  const made = await approvedWorkspace(creator, `Summary ${stamp}`);
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
        description: 'Senior AI Engineer, synthetic e2e job for the meeting summary.',
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
            // One Daniel per theme, told apart on the ranking by the theme in his name.
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

/**
 * Plays the worker for the workspace's summaries still to analyse: each MeetingSummarySubmitted.v1 in its outbox goes
 * to the real consumer and `interviews.summary.analyse` handler, with the fake model the dev server uses.
 */
async function analyse() {
  const db = createDb(databaseUrl, { max: 1 });
  try {
    const consumer = createConsumer({
      db,
      queue: SUMMARY_QUEUE,
      handlers: createSummaryHandlers({
        ai: createAiClient({
          provider: providerFromEnv({
            AI_PROVIDER: 'fake',
            APP_ENV: 'local',
            AI_FAKE_FIXTURES: join(import.meta.dirname, '..', 'ai-fixtures.json'),
          }),
          budget: memoryTokenBudget(),
        }),
        ...createApprovedRubricReads(),
        identifiersOf: async (tx, workspace, candidateId) => {
          const person = await readPersonAsSystem(tx, workspace, candidateId);
          return person && { names: [person.displayName], emails: person.emails, phones: person.phones };
        },
        memberName: async () => null,
        scheduler: { schedule: async () => '0', cancel: async () => undefined },
      }),
      now: () => new Date(),
    });
    const events = await withWorkspace(db, workspaceId, (tx) =>
      tx.execute<{ id: string; type: string; payload: unknown; occurred_at: string }>(
        sql`select id, type, payload, occurred_at from interviews.outbox where type = 'MeetingSummarySubmitted.v1'`,
      ),
    );
    for (const event of events) {
      let settled = '';
      await consumer.handle({
        body: {
          id: event.id,
          type: event.type,
          workspaceId,
          payload: event.payload,
          occurredAt: new Date(event.occurred_at).toISOString(),
          correlationId: null,
        },
        deliveryCount: 1,
        complete: async () => void (settled = 'complete'),
        abandon: async () => void (settled = 'abandon'),
        deadLetter: async (reason) => void (settled = `deadLetter: ${reason}`),
      });
      // A summary analysed earlier is skipped by the consumer's inbox and completed all the same.
      expect(settled).toBe('complete');
    }
  } finally {
    await db.$client.end();
  }
}

const panel = (page: Page) => page.getByRole('region', { name: 'Meeting summary' });
const effect = (page: Page) => page.getByRole('region', { name: 'Effect on the assessment' });

/** Daniel's row on the job's ranking, in a second tab so the interview page keeps its state. */
async function rankedRow(page: Page, theme: string) {
  const tab = await page.context().newPage();
  await tab.goto('/app/jobs');
  await tab.getByRole('link', { name: 'Senior AI Engineer' }).click();
  const row = tab
    .getByRole('table', { name: 'Ranked candidates' })
    .getByRole('row')
    .filter({ hasText: `Daniel Novak ${theme}` });
  await expect(row).toBeVisible();
  return { tab, row };
}

/** Pastes the summary and chooses "Analyse summary" by keyboard, then lets the worker analyse it. */
async function pasteAndAnalyse(page: Page, text = SUMMARY) {
  const box = panel(page).getByRole('textbox', { name: 'Summary of the interview' });
  await box.focus();
  await page.keyboard.insertText(text);
  await expect(panel(page).getByText(`${text.length} of 12,000 characters`)).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(panel(page).getByRole('button', { name: 'Analyse summary' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(panel(page).getByText('Analysing the summary…')).toBeVisible();
  await analyse();
  // The page asks again every few seconds while the worker analyses.
  await expect(effect(page)).toBeVisible({ timeout: 15_000 });
}

/** Scenario: A downgrade from a summary is off until I include it (AIV-P1-138): unticked, with its note, axe clean. */
// SAFETY: mutation check: `includedByDefault` no longer excluded a lowering finding -> both theme tests failed here
// (the include box was checked)
async function downgradeIsOff(page: Page) {
  await pasteAndAnalyse(page, LOWERING);
  await expect(effect(page).getByText('Retrieval and evaluation: Supporting to Claim only')).toBeVisible();
  await expect(
    effect(page).getByText('Lowers the evidence. Include it only if the summary says this was not shown.'),
  ).toBeVisible();
  await expect(
    effect(page).getByRole('checkbox', { name: 'Include this change: Retrieval and evaluation' }),
  ).not.toBeChecked();
  await expect(effect(page).getByText('No change is included. The backed score stays as it is.')).toBeVisible();
  await expect(effect(page).getByRole('button', { name: 'Apply 0 changes' })).toBeDisabled();
  await expectAccessible(page);
}

for (const theme of themes) {
  test(`Scenario: paste, analyse, preview and ${theme === 'light' ? 'apply' : 'decline'}, by keyboard, axe clean (${theme})`, async ({
    page,
    context,
    baseURL,
  }) => {
    await context.addCookies([{ name: 'theme', value: theme, url: baseURL ?? '' }]);
    await signIn(page, { email: creator });
    await page.goto(`/app/interviews/${interviewOf.get(theme)}`);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await expect(panel(page).getByRole('heading', { level: 2, name: 'Meeting summary' })).toBeVisible();
    await expect(
      panel(page).getByText('Names, emails and phone numbers are removed before Credalent reads it.'),
    ).toBeVisible();

    // Scenario Outline: Input limits: an empty box analyses nothing.
    await panel(page).getByRole('button', { name: 'Analyse summary' }).click();
    await expect(panel(page).getByRole('alert')).toHaveText('Paste the meeting summary first.');
    await expectAccessible(page);

    if (theme === 'light') {
      await downgradeIsOff(page);
      await effect(page).getByRole('button', { name: 'Decline' }).click();
      await expect(
        panel(page).getByText('Declined. Nothing changed, and the summary stays on this interview.'),
      ).toBeVisible();
    }

    // Scenario: Analysing a summary proposes a change and applies nothing.
    await pasteAndAnalyse(page);
    await expect(effect(page).getByText('Retrieval and evaluation: Supporting to Medium')).toBeVisible();
    await expect(effect(page).locator('mark')).toHaveText(`cited evidence ${QUOTE}`);
    await expect(effect(page).getByText('Backed score 55 to 67')).toBeVisible();
    await expect(effect(page).getByText('Before: Observed')).toBeVisible();
    await expect(effect(page).getByText('After: Projection')).toBeVisible();
    await expect(effect(page).getByText('Nothing changes until you confirm.')).toBeVisible();
    // One primary button in the view: while the card is open, "Submit scorecard" is a default one.
    await expect(page.getByRole('button', { name: 'Submit scorecard' })).not.toHaveClass(/\bbg-action\b/);
    await expect(
      effect(page).getByText('Cost and reliability: not covered in the summary · stays a gap'),
    ).toBeVisible();
    await expect(effect(page).getByLabel('Reason for Retrieval and evaluation')).toHaveValue(
      'Describes the evaluation set he built and how its answers were graded.',
    );
    await expectAccessible(page);
    const before = await rankedRow(page, theme);
    await expect(before.row).toContainText('55up to 71 if claims hold');
    await before.tab.close();

    if (theme === 'dark') {
      // Scenario: Declining applies nothing. Escape never declines: it takes the "Decline" button.
      await effect(page).getByRole('button', { name: 'Decline' }).focus();
      await page.keyboard.press('Escape');
      await expect(effect(page)).toBeVisible();
      await page.keyboard.press('Enter');
      await expect(
        panel(page).getByText('Declined. Nothing changed, and the summary stays on this interview.'),
      ).toBeVisible();
      await expectAccessible(page);
      const after = await rankedRow(page, theme);
      await expect(after.row).toContainText('55up to 71 if claims hold');
      await after.tab.close();

      // Scenario: Including the downgrade is my decision: ticked by keyboard, given a reason, applied.
      await downgradeIsOff(page);
      const include = effect(page).getByRole('checkbox', { name: 'Include this change: Retrieval and evaluation' });
      await include.focus();
      await page.keyboard.press('Space');
      await expect(include).toBeChecked();
      await expect(effect(page).getByLabel('Reason for Retrieval and evaluation')).not.toHaveValue('');
      await expect(effect(page).getByText('Backed score 55 to 55')).toBeVisible();
      const apply = effect(page).getByRole('button', { name: 'Apply 1 change' });
      await expect(apply).toBeEnabled();
      await apply.focus();
      await page.keyboard.press('Enter');
      await expect(
        panel(page).getByText(
          'The changes you confirmed are applied and logged. The assessment and the ranking are updated.',
        ),
      ).toBeVisible();
      await expectAccessible(page);
      // The ranking is recomputed with the change: the backed score stays 55, as a Supporting claim counted zero.
      await expect((await rankedRow(page, theme)).row).toContainText('55');
      return;
    }

    // Unticking the change leaves nothing to apply; ticking it again previews it again.
    const include = effect(page).getByRole('checkbox', { name: 'Include this change: Retrieval and evaluation' });
    await include.focus();
    await page.keyboard.press('Space');
    await expect(effect(page).getByRole('button', { name: 'Apply 0 changes' })).toBeDisabled();
    await page.keyboard.press('Space');
    await expect(effect(page).getByText('Backed score 55 to 67')).toBeVisible();

    // Scenario: Confirming applies, records the source and audits each change.
    const apply = effect(page).getByRole('button', { name: 'Apply 1 change' });
    await expect(apply).toBeEnabled();
    await apply.focus();
    await page.keyboard.press('Enter');
    await expect(
      panel(page).getByText(
        'The changes you confirmed are applied and logged. The assessment and the ranking are updated.',
      ),
    ).toBeVisible();
    await expectAccessible(page);
    // The new score on the ranking.
    const after = await rankedRow(page, theme);
    await expect(after.row).toContainText('67up to 71 if claims hold');
    // And the summary is a source on his evidence profile for that competency.
    await after.row.getByRole('link', { name: `Daniel Novak ${theme}` }).click();
    await expect(after.tab.getByText("Interviewer's summary", { exact: false }).first()).toBeVisible();
    // The interviewer's word, never "Candidate-submitted" (AGENTS.md 1.6).
    await expect(after.tab.getByText("Interviewer's word", { exact: true }).first()).toBeVisible();
    await expect(after.tab.getByText(QUOTE).first()).toBeVisible();
  });
}

test('Scenario Outline: a member of another workspace: the interview and its summary are not found', async ({
  page,
}) => {
  // hana.owner belongs to AP's workspace "Demo" (seed.ts), not to this spec's: the interview page is a 404 for her.
  // The 403 examples (an unassigned interviewer, a hiring owner with no grant) are proven on the server actions' module
  // in tests/integration/src/meeting-summary.test.ts.
  await signIn(page, { email: 'hana.owner@example.com' });
  const response = await page.goto(`/app/interviews/${interviewOf.get('light')}`);
  expect(response?.status()).toBe(404);
  await expect(page.getByRole('heading', { name: 'Meeting summary' })).toHaveCount(0);
});
