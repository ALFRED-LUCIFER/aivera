import { createAssessment } from '@credalent/assessment/composition';
import { createAudit } from '@credalent/audit/composition';
import { createCandidates, displayNamesInWorkspace } from '@credalent/candidates/composition';
import { withWorkspace } from '@credalent/db';
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
import { expectAccessible, focusInView, themes } from './gallery.ts';
import { approvedWorkspace } from './workspaces.ts';

// AIV-P1-165 (section 9, causes found 1): the bulk bar's "Choose for interview" and "Add to decision pack" on a ranking
// of 30, scrolled as a pilot recruiter scrolls it. This spec has a workspace of its own: Ayesha Perera (admin) and a
// Senior AI Engineer job with an approved rubric and no hiring owner; Maria Santos and Priya Nair assessed at 55, and 28
// synthetic applicants not yet scored. The bar sits above the table, so a person who ticked rows near the bottom
// scrolls back up until it shows at the top of the window, and the preview opens above it, out of view: these tests
// click it there with the mouse, as a person does, not with Playwright's click, which first centres the button. Before
// the fix, pressing an action again while its preview was open updated the card out of view and left focus on the
// button: nothing visible happened (the outline's second open failed).
// Serial: the decision pack the first test builds is the second's "existing pack".
test.describe.configure({ mode: 'serial' });
test.use({ viewport: { width: 1280, height: 800 } });

let creator: string;
let creatorId: string;
let workspaceId: string;
const ASSESSED = ['Maria Santos', 'Priya Nair'];
// Rows 3 to 30: unscored, so they rank after the two assessed, in arrival order.
const OTHERS = Array.from({ length: 28 }, (_, i) => `Synthetic applicant ${String(i + 3).padStart(2, '0')}`);
const ROW_25 = 'Synthetic applicant 25';
const ROW_26 = 'Synthetic applicant 26';

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
  creator = `ap+bulk-${stamp}@example.com`;
  const made = await approvedWorkspace(creator, `Bulk ${stamp}`);
  creatorId = made.creatorUserId;
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
    await workspaces.withWorkspace({ userId: made.creatorUserId }, made.workspaceId, async (ctx) => {
      const job = await jobs.createJob(ctx, {
        title: 'Senior AI Engineer',
        jobType: 'ai_llm_engineering',
        description: 'Senior AI Engineer, synthetic e2e job for bulk actions on a scrolled ranking.',
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
      const python = rubric.competencies.find((c) => c.name === 'Python service engineering')?.id ?? '';
      for (const [i, name] of [...ASSESSED, ...OTHERS].entries()) {
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
        await evidence.recordEvidence(ctx, {
          candidateId: personId,
          source: {
            kind: 'repository',
            label: 'rag-service',
            url: 'https://code.credalent.example/candidate/rag-service',
            blobFileId: null,
            capturedAt: new Date('2026-11-10T08:00:00.000Z'),
            checkedAt: new Date('2026-11-12T08:00:00.000Z'),
            checkMethod: 'Commit history',
          },
          items: [
            {
              excerpt: 'authored 301 of 340 commits',
              excerptSpan: null,
              provenance: 'corroborated',
              strength: 'strong',
              limit: 'Shows the code, not its use.',
              competencies: [{ jobId: job.id, competencyId: python, level: 5 }],
            },
          ],
          synthetic: true,
        });
        await assessment.assessCandidate(ctx, {
          candidateId: personId,
          jobId: job.id,
          rubric: { versionId: rubric.id, competencies: rubric.competencies },
          evidence: await evidence.listEvidenceForCandidate(ctx, personId, job.id),
        });
      }
    });
  } finally {
    await db.$client.end();
  }
});

const table = (page: Page) => page.getByRole('table', { name: 'Ranked candidates' });
const bar = (page: Page) => page.getByRole('region', { name: 'Bulk actions' });
const preview = (page: Page) => page.getByRole('region', { name: /^Preview: / });
const box = (page: Page, name: string) => table(page).getByRole('checkbox', { name: `Select ${name}` });
// A click before the page hydrates is lost; check() does nothing once the box is ticked, so it is safe to repeat.
const tick = (page: Page, name: string) => expect(() => box(page, name).check({ timeout: 1000 })).toPass();

/** The ranking with every row shown ("Show all 30"). */
async function openRanking(page: Page) {
  await signIn(page, { email: creator });
  await page.goto('/app/jobs');
  await page.getByRole('link', { name: 'Senior AI Engineer' }).click();
  await expect(page).toHaveTitle('Senior AI Engineer: Evidence and ranking · Credalent', { timeout: 15_000 });
  await expect(table(page).getByRole('checkbox', { name: /^Select / })).toHaveCount(8);
  await expect(() => page.getByRole('button', { name: 'Show all 30' }).click({ timeout: 1000 })).toPass();
  await expect(table(page).getByRole('checkbox', { name: /^Select / })).toHaveCount(31);
}

/** Scrolls down to `name`'s row and ticks it, as a person does. */
async function scrollAndTick(page: Page, name: string) {
  await table(page).getByRole('row').filter({ hasText: name }).scrollIntoViewIfNeeded();
  await tick(page, name);
}

/** Scrolls back up only until the bulk bar shows at the top of the window, then clicks `action` where it is. */
async function clickInBarAtTop(page: Page, action: string) {
  await bar(page).evaluate((el) => window.scrollBy(0, el.getBoundingClientRect().top - 8));
  const button = await bar(page).getByRole('button', { name: action }).boundingBox();
  if (!button) throw new Error(`No "${action}" button in the bulk bar.`);
  // An open preview sits above the bar, out of view: the click must bring it back.
  if ((await preview(page).count()) > 0) await expect(preview(page)).not.toBeInViewport();
  await page.mouse.click(button.x + button.width / 2, button.y + button.height / 2);
}

/** The preview is in view, its heading included, and holds keyboard focus. */
async function expectPreviewInViewAndFocused(page: Page) {
  await expect(preview(page).getByRole('heading')).toBeInViewport();
  await expect.poll(() => preview(page).evaluate((card) => card.contains(document.activeElement))).toBe(true);
  expect(await focusInView(page)).toBe('visible');
}

test('Scenario: Bulk actions open their preview and work for an admin recruiter', async ({ page }) => {
  await openRanking(page);
  await table(page).getByRole('checkbox', { name: 'Select all 30 shown' }).focus();
  for (const name of ASSESSED) {
    await expect(async () => {
      await page.keyboard.press('Tab');
      await expect(box(page, name)).toBeFocused({ timeout: 250 });
    }).toPass();
    await page.keyboard.press('Space');
    await expect(box(page, name)).toBeChecked();
  }
  await bar(page).getByRole('button', { name: 'Choose for interview' }).focus();
  await page.keyboard.press('Enter');
  await expect(preview(page).getByRole('heading')).toHaveText('Preview: 2 people chosen for interview');
  for (const name of ASSESSED)
    await expect(preview(page).getByRole('listitem').filter({ hasText: name })).toHaveCount(1);
  await expect(preview(page)).toContainText('Nobody is contacted');
  await expect(preview(page)).toContainText('Nothing changes until you confirm.');
  await expect(preview(page).getByRole('textbox', { name: 'Reason' })).toBeFocused();
  // Nothing has changed yet (AGENTS.md 1.5).
  await expect(table(page).getByRole('row').filter({ hasText: 'Maria Santos' })).not.toContainText('Round 1');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await expect(
    page.getByText('2 people chosen for interview. They are on the Interviews page, not scheduled yet.'),
  ).toBeVisible();
  for (const name of ASSESSED)
    await expect(table(page).getByRole('row').filter({ hasText: name })).toContainText('Round 1, not scheduled yet');
  await expect(table(page).getByRole('checkbox', { checked: true })).toHaveCount(0);

  for (const name of ASSESSED) await tick(page, name);
  await bar(page).getByRole('button', { name: 'Add to decision pack' }).focus();
  await page.keyboard.press('Enter');
  await expect(preview(page).getByRole('heading')).toHaveText('Preview: add 2 candidates to a decision pack');
  await expect(preview(page)).toContainText('Nothing changes until you confirm.');
  await expect(preview(page).getByRole('radio', { name: 'New pack' })).toBeChecked();
  await preview(page).getByRole('textbox', { name: 'Pack name' }).fill('Round 2 shortlist');
  await preview(page).getByRole('button', { name: 'Add 2 to the pack' }).click();
  await expect(page.getByText('2 candidates added to Round 2 shortlist.')).toBeVisible();
  for (const name of ASSESSED)
    await expect(table(page).getByRole('row').filter({ hasText: name })).toContainText('In shortlist pack');

  // Audited: who, when, what (AGENTS.md 3.6); the reason a person gave for the choice is the interview's.
  const db = createDb(databaseUrl, { max: 1 });
  try {
    const rows = await withWorkspace(db, workspaceId, (tx) =>
      tx.execute<{ action: string; actor_id: string; occurred_at: Date }>(
        sql`select action, actor_id, occurred_at from audit.entry
          where action in ('pack.created', 'pack.member_added') order by occurred_at`,
      ),
    );
    expect(rows.map((r) => r.action)).toEqual(['pack.created', 'pack.member_added', 'pack.member_added']);
    for (const r of rows) {
      expect(r.actor_id).toBe(creatorId);
      expect(Date.now() - new Date(r.occurred_at).getTime()).toBeLessThan(5 * 60_000);
    }
  } finally {
    await db.$client.end();
  }
});

// SAFETY: mutation check: useChooseController's onPreview also called chooseForInterview (applied on open) -> the
// "Choose for interview" outline failed (row 25 showed "Round 1, not scheduled yet" after the reload)
for (const action of ['Choose for interview', 'Add to decision pack']) {
  test(`Scenario Outline: The preview card is visible and focused on a scrolled ranking (${action})`, async ({
    page,
  }) => {
    await openRanking(page);
    await scrollAndTick(page, ROW_25);
    await scrollAndTick(page, ROW_26);
    await clickInBarAtTop(page, action);
    await expectPreviewInViewAndFocused(page);
    for (const name of [ROW_25, ROW_26]) await expect(box(page, name)).toBeChecked();

    // Open again while it is open, after ticking one more row further down: it comes back into view with all three.
    await scrollAndTick(page, 'Synthetic applicant 27');
    await clickInBarAtTop(page, action);
    await expectPreviewInViewAndFocused(page);
    await expect(preview(page).getByRole('listitem')).toHaveCount(3);
    for (const name of [ROW_25, ROW_26, 'Synthetic applicant 27']) await expect(box(page, name)).toBeChecked();
    // Nothing changed without a confirm (AGENTS.md 1.5): the server's ranking, reloaded, shows no choice and no pack.
    await page.reload();
    await expect(() => page.getByRole('button', { name: 'Show all 30' }).click({ timeout: 1000 })).toPass();
    await expect(box(page, ROW_25)).toBeChecked();
    for (const name of [ROW_25, ROW_26, 'Synthetic applicant 27']) {
      const row = table(page).getByRole('row').filter({ hasText: name });
      await expect(row).toContainText('Not yet scored');
      await expect(row).not.toContainText('Round 1');
      await expect(row).not.toContainText('In shortlist pack');
    }
  });
}

for (const theme of themes) {
  test(`axe passes with the preview open on a scrolled ranking (${theme})`, async ({ page, context, baseURL }) => {
    await context.addCookies([{ name: 'theme', value: theme, url: baseURL ?? '' }]);
    await openRanking(page);
    await scrollAndTick(page, ROW_25);
    await clickInBarAtTop(page, 'Choose for interview');
    await expectPreviewInViewAndFocused(page);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await expectAccessible(page);
  });
}
