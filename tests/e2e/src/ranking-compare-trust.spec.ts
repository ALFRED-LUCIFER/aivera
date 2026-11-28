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
import { approvedWorkspace } from './workspaces.ts';

// AIV-P1-165 §9, §10 and §17: the ranking and the comparison as a pilot recruiter reads them, in this spec's own
// workspace: Ayesha Perera (admin) and a Senior AI Engineer job with an approved rubric, no hiring owner and no decision
// pack. Seven applicants. Sara Al Qahtani is scored on a checked repository (60), Arjun Menon on a submitted document
// (36), and Maria Santos on one CV line alone, a claim stored Supporting (0, up to 32). Priya Nair and three synthetic
// applicants are not scored yet: their CVs are being read or assessed, so the ranking refreshes itself. The model is
// stubbed at the port: ai-fixtures.json answers the trade-offs prompt for Sara and Maria.
// Serial: the pack the "primary action" test makes exists for the tests after it.
test.describe.configure({ mode: 'serial' });
test.use({ viewport: { width: 1280, height: 800 } });

let creator: string;
let jobId: string;
const people: Record<string, string> = {};
const UNSCORED = ['Priya Nair', 'Synthetic applicant 05', 'Synthetic applicant 06', 'Synthetic applicant 07'];
const CV_LINE = 'Designed the evaluation set and its grading rubric for a retrieval assistant.';

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
  creator = `ayesha+trust-${stamp}@example.com`;
  const made = await approvedWorkspace(creator, `Trust ${stamp}`);
  const db = createDb(databaseUrl, { max: 1 });
  try {
    const audit = createAudit(db);
    const workspaces = createWorkspaces(db, audit);
    const jobs = createJobs(workspaces, audit);
    const applied = createCandidateJobResolver(jobs);
    const intake = createIntake(workspaces, createCandidates(workspaces), jobs, displayNamesInWorkspace, audit);
    const evidence = createEvidence(workspaces, audit, undefined, applied);
    const assessment = createAssessment(workspaces, audit, jobs, undefined, applied);
    await workspaces.withWorkspace({ userId: made.creatorUserId }, made.workspaceId, async (ctx) => {
      const job = await jobs.createJob(ctx, {
        title: 'Senior AI Engineer',
        jobType: 'ai_llm_engineering',
        description: 'Senior AI Engineer, synthetic e2e job for the ranking and the comparison.',
        synthetic: true,
      });
      jobId = job.id;
      const saved = await jobs.saveRubric(ctx, job.id, {
        successStatement: 'Ships reliable AI features.',
        competencies: [competency('LLM systems in production', 60, 4), competency('Evaluation design', 40, 3)],
      });
      const sent = await jobs.submitRubric(ctx, saved.id);
      await jobs.approveRubric(ctx, sent.id, sent.revision);
      const rubric = await createApprovedRubricReads().approvedRubric(ctx.tx, made.workspaceId, job.id);
      if (!rubric) throw new Error('The rubric was not approved.');
      const idOf = (name: string) => rubric.competencies.find((c) => c.name === name)?.id ?? '';
      const capturedAt = new Date('2026-11-10T08:00:00.000Z');
      const scored = {
        'Sara Al Qahtani': {
          source: {
            kind: 'repository' as const,
            label: 'ranking-service',
            url: 'https://code.credalent.example/candidate/ranking-service',
            checkedAt: new Date('2026-11-12T08:00:00.000Z'),
            checkMethod: 'Commit history',
          },
          item: {
            excerpt: 'authored 512 of 540 commits',
            provenance: 'corroborated' as const,
            strength: 'strong' as const,
          },
          link: { competencyId: idOf('LLM systems in production'), level: 5 },
        },
        'Arjun Menon': {
          source: { kind: 'document' as const, label: 'Design note', url: null, checkedAt: null, checkMethod: null },
          item: {
            excerpt: 'Describes the fallback path of a support assistant.',
            provenance: 'submitted' as const,
            strength: 'medium' as const,
          },
          link: { competencyId: idOf('LLM systems in production'), level: 3 },
        },
        'Maria Santos': {
          source: { kind: 'cv' as const, label: 'CV', url: null, checkedAt: null, checkMethod: null },
          item: { excerpt: CV_LINE, provenance: 'claim' as const, strength: 'supporting' as const },
          link: { competencyId: idOf('Evaluation design'), level: 4 },
        },
      };
      for (const [i, name] of [...Object.keys(scored), ...UNSCORED].entries()) {
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
        people[name] = personId;
        const work = scored[name as keyof typeof scored];
        if (!work) {
          // A CV the worker is still reading (the last one) or has read and is assessing: no worker runs here.
          const fileId = crypto.randomUUID();
          await ctx.tx.execute(sql`insert into files.file (id, workspace_id, purpose, content_type, file_name,
            size_bytes, status, blob_path, uploaded_by, created_at) values (${fileId}, ${made.workspaceId}, 'cv',
            'application/pdf', ${`cv-${i}.pdf`}, 2048, 'clean', ${`cvs/w/${made.workspaceId}/${fileId}`},
            ${ctx.userId}, now())`);
          const { sourceId } = await evidence.requestCvParse(ctx, { candidateId: personId, fileId, synthetic: true });
          await ctx.tx.execute(sql`update evidence.cv_parse set status = ${name.endsWith('07') ? 'pending' : 'parsed'}
            where source_id = ${sourceId}`);
          continue;
        }
        await evidence.recordEvidence(ctx, {
          candidateId: personId,
          source: { ...work.source, blobFileId: null, capturedAt },
          items: [
            {
              ...work.item,
              excerptSpan: work.source.kind === 'cv' ? 'page 1' : null,
              limit: 'Shows the work, not its use.',
              competencies: [{ jobId: job.id, ...work.link }],
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
const row = (page: Page, name: string) => table(page).getByRole('row').filter({ hasText: name });
const box = (page: Page, name: string) => table(page).getByRole('checkbox', { name: `Select ${name}` });
const bar = (page: Page) => page.getByRole('region', { name: 'Bulk actions' });
const grid = (page: Page) => page.getByRole('table', { name: 'Candidates compared by competency' });
const tradeoffs = (page: Page) => page.getByRole('region', { name: 'The trade-offs' });
// A click before the page hydrates is lost; check() does nothing once the box is ticked, so it is safe to repeat.
const tick = (page: Page, name: string) => expect(() => box(page, name).check({ timeout: 1000 })).toPass();

async function openRanking(page: Page) {
  await signIn(page, { email: creator });
  await page.goto(`/app/jobs/${jobId}/candidates`);
  await expect(page).toHaveTitle('Senior AI Engineer: Evidence and ranking · Credalent', { timeout: 15_000 });
  await expect(table(page).getByRole('checkbox', { name: /^Select / })).toHaveCount(8);
}

/** Opens the comparison of the three highest ranked: Sara, Arjun and Maria. */
async function compareTop(page: Page) {
  await openRanking(page);
  await page.getByRole('link', { name: 'Compare top 3' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Compare candidates' })).toBeVisible();
}

test('Scenarios: Each row gives a one-line cited reason; Before scoring, one cell, and four default columns', async ({
  page,
}) => {
  await openRanking(page);
  await expect(table(page).getByRole('columnheader')).toHaveText([
    'Select all 7 shown',
    '#',
    'Candidate',
    'Backed score',
    "Meets the job's need",
    'Next action',
  ]);
  // Work behind the rank: the competency that adds most to the backed score, linking to the cited item on the profile.
  const sara = row(page, 'Sara Al Qahtani');
  await expect(sara).toContainText('Largest part of the backed score: LLM systems in production, proven at 5 of 5.');
  await expect(sara.getByText('Claim awaiting validation')).toHaveCount(0);
  await expect(sara.getByRole('link', { name: 'LLM systems in production' })).toHaveAttribute(
    'href',
    new RegExp(`^/app/candidates/${people['Sara Al Qahtani']}\\?job=${jobId}#evidence-[0-9a-f-]{36}$`),
  );
  // A claim in the line is labelled a claim, and said to count 0 (AGENTS.md 1.6).
  const maria = row(page, 'Maria Santos');
  await expect(maria).toContainText(
    'Claim awaiting validationNo work inspected yet. Largest claim: Evaluation design, claimed at 4 of 5. A claim counts 0.',
  );
  // Not scored yet: one cell says where the CV is, and no "Not yet available" pill fills the other columns.
  await expect(row(page, 'Priya Nair')).toHaveText('Select Priya NairPriya NairNewAssessing the evidence…');
  await expect(row(page, 'Synthetic applicant 07')).toHaveText(
    'Select Synthetic applicant 07Synthetic applicant 07NewReading the CV…',
  );
  // Everyone stays listed, the unscored after the ranked (AGENTS.md 1.5).
  await expect(table(page).getByRole('row')).toHaveCount(8);

  // The cited item opens on the profile.
  await maria.getByRole('link', { name: 'Evaluation design' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Maria Santos' })).toBeVisible();
  expect(new URL(page.url()).hash).toMatch(/^#evidence-[0-9a-f-]{36}$/);
  await expect(page.locator(new URL(page.url()).hash)).toContainText(CV_LINE);
});

test('Scenarios: Shortcuts and counts that open; The Columns menu closes with Escape, by keyboard', async ({
  page,
}) => {
  await openRanking(page);
  // The Columns button is a disclosure: Enter opens it, Space ticks a column, Escape closes it and returns focus.
  const columns = page.locator('summary', { hasText: 'Columns' });
  await expect(async () => {
    await columns.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('group', { name: 'Columns to show' })).toBeVisible({ timeout: 1000 });
  }).toPass();
  const missing = page.getByRole('checkbox', { name: 'Missing critical evidence' });
  await expect(missing).not.toBeChecked();
  await missing.focus();
  await page.keyboard.press('Space');
  await expect(table(page).getByRole('columnheader', { name: 'Missing critical evidence' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('group', { name: 'Columns to show' })).toBeHidden();
  await expect(columns).toBeFocused();

  // "Missing critical evidence" is a count that opens to the competencies. Sara has no evidence of Evaluation design.
  const count = row(page, 'Sara Al Qahtani').locator('summary', { hasText: '1 competency' });
  await expect(row(page, 'Sara Al Qahtani').getByRole('listitem')).toBeHidden();
  await count.focus();
  await page.keyboard.press('Enter');
  await expect(row(page, 'Sara Al Qahtani').getByRole('listitem')).toHaveText(['Evaluation design']);

  // "Compare top 3" opens Compare with the three highest ranked, in rank order.
  await page.getByRole('link', { name: 'Compare top 3' }).click();
  await expect(page).toHaveURL(
    new RegExp(
      `/app/jobs/${jobId}/compare\\?ids=${people['Sara Al Qahtani']},${people['Arjun Menon']},${people['Maria Santos']}$`,
    ),
  );
  await expect(grid(page).getByRole('columnheader')).toHaveCount(4);
});

test('Scenario: The ranking fits 1280 and keeps fast ticks', async ({ page }) => {
  await openRanking(page);
  // No sideways scroll at 1280 x 800: neither the page nor the table's own scroll box, "Next action" included.
  await expect(table(page).getByRole('columnheader', { name: 'Next action' })).toBeInViewport({ ratio: 1 });
  expect(
    await table(page).evaluate((el) => {
      const scroller = el.parentElement;
      return {
        page: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        table: !!scroller && scroller.scrollWidth <= scroller.clientWidth,
      };
    }),
  ).toEqual({ page: true, table: true });

  // Hydrated once a tick shows; then start from nothing ticked.
  await tick(page, 'Maria Santos');
  await box(page, 'Maria Santos').uncheck();
  await expect(bar(page)).toHaveCount(0);
  // Two ticks within 300 ms both stay.
  const started = Date.now();
  await box(page, 'Sara Al Qahtani').click();
  await box(page, 'Arjun Menon').click();
  expect(Date.now() - started).toBeLessThan(300);
  await expect(bar(page).getByRole('status')).toHaveText('2 selected');

  // And a tick made while the page is refreshing itself (a CV is being read, so it does every 5 s) stays too: the
  // refresh's answer is held back until the tick is in, then let through.
  const held = Promise.withResolvers<void>();
  const inFlight = Promise.withResolvers<void>();
  await page.route(
    (url) => url.pathname.endsWith('/candidates'),
    async (route) => {
      if (route.request().headers()['rsc'] === undefined) return route.continue();
      inFlight.resolve();
      await held.promise;
      await route.continue();
    },
  );
  await inFlight.promise;
  await box(page, 'Maria Santos').click();
  await expect(bar(page).getByRole('status')).toHaveText('3 selected');
  const answered = page.waitForResponse((response) => response.request().headers()['rsc'] !== undefined);
  held.resolve();
  await answered;
  await page.unrouteAll({ behavior: 'wait' });
  // Still all three once the refresh has landed and the URL has caught up.
  await page.waitForTimeout(1000);
  for (const name of ['Sara Al Qahtani', 'Arjun Menon', 'Maria Santos']) await expect(box(page, name)).toBeChecked();
  await expect(bar(page).getByRole('status')).toHaveText('3 selected');
  expect(new URL(page.url()).searchParams.get('selected')?.split(',')).toHaveLength(3);
});

test('Scenarios: Claim-only cells are short and honest; The same evidence has the same strength label everywhere', async ({
  page,
}) => {
  await compareTop(page);
  await expect(grid(page).getByRole('columnheader')).toHaveText([
    'Competency',
    'Sara Al Qahtani60',
    'Arjun Menon36',
    // "Claim awaiting validation" once for the column, under the score.
    'Maria Santos0up to 32 if claims holdClaim awaiting validation',
  ]);
  const evaluation = grid(page).getByRole('row', { name: /^Evaluation design/ });
  // The quoted CV line first, then one status line: the strength the profile shows, and that the claim counts 0.
  await expect(evaluation.getByRole('cell').nth(2)).toHaveText(`“${CV_LINE}”SupportingClaim. Counts 0 against 3.`);
  await expect(grid(page).getByText('Claim awaiting validation')).toHaveCount(1);
  await expect(grid(page).getByText('Claim only')).toHaveCount(0);
  // Neutral ink: the same colour as the row's weight line, not a status chip.
  const tag = grid(page).getByText('Claim awaiting validation');
  const neutral = grid(page).getByText('Weight 40% · job needs 3 of 5');
  expect(await tag.evaluate((el) => getComputedStyle(el).color)).toBe(
    await neutral.evaluate((el) => getComputedStyle(el).color),
  );
  expect(await tag.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgba(0, 0, 0, 0)');

  // The same line on Maria's profile carries the same label.
  await grid(page).getByRole('link', { name: 'Maria Santos' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Maria Santos' })).toBeVisible();
  const card = page.getByRole('article').filter({ hasText: CV_LINE });
  await expect(card.getByText('Supporting', { exact: true })).toBeVisible();
  await expect(card.getByText('Claim only', { exact: true })).toHaveCount(0);
});

test('Scenario: Trade-offs for whoever is scored', async ({ page }) => {
  await openRanking(page);
  for (const name of ['Sara Al Qahtani', 'Maria Santos', 'Priya Nair']) await tick(page, name);
  await bar(page).getByRole('button', { name: 'Compare' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Compare candidates' })).toBeVisible();
  await expect(grid(page).getByRole('columnheader').last()).toHaveText('Priya NairNot yet scoredNot yet available');
  // 2 of the 3 are scored: the trade-offs are offered for them, and the third is named.
  await expect(tradeoffs(page).getByText('Priya Nair is not scored yet.')).toBeVisible();
  await tradeoffs(page).getByRole('button', { name: 'Show the trade-offs' }).click();
  const sara = tradeoffs(page).getByRole('list', { name: 'Sara Al Qahtani' }).getByRole('listitem');
  await expect(sara).toHaveText([
    'Sara Al Qahtani is the only one compared with independently checked work on LLM systems in production.',
    /^Cited evidence for Sara Al Qahtani:.*authored 512 of 540 commitsSource: ranking-service/,
  ]);
  // Each statement cites evidence: the snapshot on the profile, or the cited item there.
  await expect(sara.first().getByRole('link', { name: 'Sara Al Qahtani' })).toHaveAttribute(
    'href',
    `/app/candidates/${people['Sara Al Qahtani']}?job=${jobId}`,
  );
  await expect(sara.nth(1).getByRole('link')).toHaveAttribute('href', /#evidence-[0-9a-f-]{36}$/);
  await expect(tradeoffs(page).getByRole('list', { name: 'Maria Santos' }).getByRole('listitem')).toHaveText([
    'Maria Santos still rests on claims for Evaluation design.',
  ]);
  await expect(tradeoffs(page).getByRole('list', { name: 'Priya Nair' })).toHaveCount(0);
  await expect(tradeoffs(page).getByText('Priya Nair is not scored yet.')).toBeVisible();
  await expect(tradeoffs(page)).toContainText('60 points separate the 2 scored candidates.');
});

for (const width of [1280, 1440]) {
  for (const theme of themes) {
    test(`axe passes on the ranking and the comparison at ${width} (${theme})`, async ({ page, context, baseURL }) => {
      await context.addCookies([{ name: 'theme', value: theme, url: baseURL ?? '' }]);
      await page.setViewportSize({ width, height: 800 });
      await openRanking(page);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await expectAccessible(page);
      // With the Columns menu open and every column shown.
      await expect(async () => {
        await page.locator('summary', { hasText: 'Columns' }).click();
        await expect(page.getByRole('group', { name: 'Columns to show' })).toBeVisible({ timeout: 1000 });
      }).toPass();
      for (const name of ['Weight on Strong evidence', 'Missing critical evidence', 'Last scored'])
        await page.getByRole('checkbox', { name }).check();
      await expectAccessible(page);
      await page.keyboard.press('Escape');
      await page.getByRole('link', { name: 'Compare top 3' }).click();
      await expect(page.getByRole('heading', { level: 1, name: 'Compare candidates' })).toBeVisible();
      await expect(grid(page).getByText('Claim awaiting validation')).toHaveCount(1);
      await expectAccessible(page);
    });
  }
}

// Last: it makes the job's first decision pack.
test('Scenario: The primary action creates the pack when none exists, by keyboard', async ({ page }) => {
  await compareTop(page);
  // No pack yet: no "Open decision pack", and the primary action adds the compared candidates to one.
  await expect(page.getByRole('link', { name: 'Open decision pack' })).toHaveCount(0);
  const add = page.getByRole('button', { name: 'Add these to a decision pack' });
  const secondary = page.getByRole('link', { name: 'Change selection' });
  expect(await add.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe(
    await secondary.evaluate((el) => getComputedStyle(el).backgroundColor),
  );
  const preview = page.getByRole('region', { name: /^Preview: / });
  await expect(async () => {
    await add.focus();
    await page.keyboard.press('Enter');
    await expect(preview).toBeVisible({ timeout: 1000 });
  }).toPass();
  await expect(preview.getByRole('heading')).toHaveText('Preview: add 3 candidates to a decision pack');
  await expect(preview).toContainText('Nothing changes until you confirm.');
  await expect(preview.getByRole('listitem')).toHaveCount(3);
  // Nothing changed by opening it.
  await expect(page.getByRole('link', { name: 'Open decision pack' })).toHaveCount(0);
  await preview.getByLabel('Pack name').fill('Shortlist');
  await preview.getByRole('button', { name: 'Add 3 to the pack' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByText('3 candidates added to Shortlist.')).toBeVisible();
  // A pack with members exists now: "Open decision pack" shows, and opens the job's packs.
  const open = page.getByRole('link', { name: 'Open decision pack' });
  await expect(open).toBeVisible();
  await expect(open).toHaveAttribute('href', `/app/jobs/${jobId}/pack`);
  await expectAccessible(page);
});
