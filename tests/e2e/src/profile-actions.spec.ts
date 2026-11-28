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
import { expectAccessible, themes } from './gallery.ts';
import { approvedWorkspace } from './workspaces.ts';

// AIV-P1-165 §8, §11 and §12, steps of J2 and J3: from one candidate's evidence profile the recruiter moves through the
// ranking, chooses for interview, starts the interview, rates only what was tested, adds to a decision pack and
// corrects a name. A workspace of its own, so nothing here moves anybody another spec reads: a Senior AI Engineer job
// with an approved rubric of six competencies (so the radar has labels on every side); "Maria Santo" (her name read
// one letter short), Daniel Novak and Priya Nair assessed from real evidence to the same score, ranked in that order
// (the first assessed leads a tie), each with "Retrieval and evaluation" resting on a CV claim and the rest unproven;
// and Omar Al Suwaidi, not yet scored.

let creator: string;
let creatorUserId: string;
let workspaceId: string;
let jobId: string;
const person = new Map<string, string>();

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
  creator = `alex+profile-actions-${stamp}@example.com`;
  const made = await approvedWorkspace(creator, `Profile actions ${stamp}`);
  ({ workspaceId, creatorUserId } = made);
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
    await workspaces.withWorkspace({ userId: creatorUserId }, workspaceId, async (ctx) => {
      const job = await jobs.createJob(ctx, {
        title: 'Senior AI Engineer',
        jobType: 'ai_llm_engineering',
        description: 'Senior AI Engineer, synthetic e2e job for the profile actions.',
        synthetic: true,
      });
      jobId = job.id;
      const saved = await jobs.saveRubric(ctx, job.id, {
        successStatement: 'Ships reliable AI features.',
        competencies: [
          competency('Python service engineering', 30, 4),
          competency('Evaluation design and measurement', 20, 3),
          competency('Retrieval and evaluation', 20, 3),
          competency('Cost and reliability', 10, 3),
          competency('LLM systems in production', 10, 3),
          competency('Product judgement', 10, 3),
        ],
      });
      const sent = await jobs.submitRubric(ctx, saved.id);
      await jobs.approveRubric(ctx, sent.id, sent.revision);
      const rubric = await approvedRubric(ctx.tx, workspaceId, job.id);
      if (!rubric) throw new Error('The rubric was not approved.');
      const idOf = (name: string) => rubric.competencies.find((c) => c.name === name)?.id ?? '';
      for (const [i, name] of ['Maria Santo', 'Daniel Novak', 'Priya Nair', 'Omar Al Suwaidi'].entries()) {
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
        person.set(name, personId);
        if (i > 2) continue;
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
                // As the CV parse and mapping store a CV line: Supporting, "Claim awaiting validation".
                strength: kind === 'cv' ? 'supporting' : 'strong',
                limit: kind === 'cv' ? 'CV statement only; nothing to inspect yet.' : 'Shows the code, not its use.',
                competencies: [{ jobId: job.id, competencyId: idOf(competencyName), level }],
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

const profilePath = (name: string) => `/app/candidates/${person.get(name)}?job=${jobId}`;
const preview = (page: Page) => page.getByRole('region', { name: /^Preview: / });
const interviewsTab = () => `/app/jobs/${jobId}/interviews`;

async function openProfile(page: Page, name: string) {
  await page.goto(profilePath(name));
  await expect(page.getByRole('heading', { level: 1, name, exact: true })).toBeVisible();
}

/** Rows of this spec's workspace, read as the application role under row-level security. */
async function inWorkspace<T extends Record<string, unknown>>(query: ReturnType<typeof sql>) {
  const db = createDb(databaseUrl, { max: 1 });
  try {
    return await withWorkspace(db, workspaceId, async (tx) => [...(await tx.execute<T>(query))]);
  } finally {
    await db.$client.end();
  }
}
const messagesQueued = async () =>
  (await inWorkspace<{ n: number }>(sql`select count(*)::int as n from notifications.message`))[0]?.n;

// Each test leaves the state the next one reads.
test.describe.configure({ mode: 'serial' });

for (const theme of themes) {
  test(`Scenario: The empty Interviews tab teaches the next step, by keyboard, axe clean (${theme})`, async ({
    page,
    context,
    baseURL,
  }) => {
    await context.addCookies([{ name: 'theme', value: theme, url: baseURL ?? '' }]);
    await signIn(page, { email: creator });
    await page.goto(interviewsTab());
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await expect(page).toHaveTitle('Senior AI Engineer: Interviews · Credalent');
    await expect(
      page.getByText(
        'No candidate is chosen for interview yet. On the ranking, tick the candidates to interview and choose “Choose for interview”. Nobody is contacted.',
      ),
    ).toBeVisible();
    await expect(page.getByRole('table', { name: 'Interviews' })).toHaveCount(0);
    await expectAccessible(page);
    await page.getByRole('link', { name: 'Go to ranking' }).focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveTitle('Senior AI Engineer: Evidence and ranking · Credalent');
    await expect(page).toHaveURL(new RegExp(`/app/jobs/${jobId}/candidates$`));
  });

  for (const width of [1280, 1440]) {
    test(`Scenario: One primary action, next / previous, the index and calm evidence cards at ${width} (${theme})`, async ({
      page,
      context,
      baseURL,
    }) => {
      await context.addCookies([{ name: 'theme', value: theme, url: baseURL ?? '' }]);
      await page.setViewportSize({ width, height: 900 });
      await signIn(page, { email: creator });
      await openProfile(page, 'Daniel Novak');
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);

      // One primary action; Previous and Next follow the ranking order: Maria Santo, Daniel Novak, Priya Nair.
      await expect(page.getByRole('button', { name: 'Choose for interview' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Add to decision pack' })).toHaveCount(0);
      await expect(page.getByRole('link', { name: 'Previous candidate' })).toHaveAttribute(
        'href',
        profilePath('Maria Santo'),
      );
      await expect(page.getByRole('link', { name: 'Next candidate' })).toHaveAttribute(
        'href',
        profilePath('Priya Nair'),
      );

      // Scenario: Calm evidence cards. A claim is called a claim, in neutral ink, and each card states its limit once.
      const claim = page.getByRole('article', { name: /^Retrieval and evaluation/ });
      await expect(claim.getByText('Claim only', { exact: true })).toBeVisible();
      await expect(claim.getByText(/^Limit:/)).toHaveCount(1);
      await expect(claim.getByText('A claim, not inspected work. It counts zero in the backed score.')).toBeVisible();
      // SAFETY: a claim's words are never highlighted (AGENTS.md 1.6).
      await expect(claim.locator('mark')).toHaveCount(0);
      await expect(page.getByText('Claim awaiting validation')).toHaveCount(0);
      for (const card of await page.getByRole('article').all())
        expect(await card.getByText(/^Limit:/).count()).toBeLessThanOrEqual(1);

      // The radar's labels are whole inside the chart: none cut off at its edge, none shortened.
      // SAFETY: mutation check: `LABEL_LINE` raised to 60, so no label wraps -> this check failed ("Evaluation design
      // and measurement" ran past the chart's right edge).
      const radar = page.getByRole('img', { name: /^Radar of 6 competencies/ });
      await expect(radar).toBeVisible();
      const outside = await radar.evaluate((svg) => {
        const box = svg.getBoundingClientRect();
        return [...svg.querySelectorAll('text')]
          .map((text) => ({ label: text.textContent, at: text.getBoundingClientRect() }))
          .filter(
            ({ at }) =>
              at.width === 0 ||
              at.left < box.left ||
              at.right > box.right ||
              at.top < box.top ||
              at.bottom > box.bottom,
          )
          .map(({ label }) => label);
      });
      expect(outside).toEqual([]);
      await expect(radar.locator('text')).toHaveText([
        'Python serviceengineering',
        'Evaluation designand measurement',
        'Retrieval andevaluation',
        'Cost andreliability',
        'LLM systems inproduction',
        'Product judgement',
      ]);
      await expectAccessible(page);

      // Scenario: Interview questions one click away, by keyboard: the heading takes focus.
      const link = page.getByRole('navigation', { name: 'On this page' }).getByRole('link', {
        name: 'Interview questions',
      });
      const heading = page.getByRole('heading', { level: 2, name: 'Interview questions' });
      // A key press before the page hydrates only scrolls, so it is repeated until the heading has focus.
      await expect(async () => {
        await link.focus();
        await page.keyboard.press('Enter');
        await expect(heading).toBeFocused({ timeout: 500 });
      }).toPass();
      await expect(heading).toBeInViewport();
      await expect(page).toHaveURL(/#questions$/);
    });
  }
}

test('Scenario: Choose for interview from the profile, then schedule and start the interview; nothing is sent', async ({
  page,
}) => {
  const queued = await messagesQueued();
  await signIn(page, { email: creator });
  await openProfile(page, 'Daniel Novak');
  // A click before the page hydrates is lost, so it is repeated until the preview opens.
  await expect(async () => {
    await page.getByRole('button', { name: 'Choose for interview' }).click({ timeout: 1000 });
    await expect(preview(page)).toBeVisible({ timeout: 1000 });
  }).toPass();
  await expect(preview(page).getByRole('heading')).toHaveText('Preview: 1 person chosen for interview');
  await expect(preview(page)).toContainText('Daniel Novak');
  await expect(preview(page)).toContainText('Nothing changes until you confirm.');
  // Nothing has changed yet.
  await expect(page.getByText('Senior AI Engineer · New', { exact: true })).toBeVisible();
  await preview(page).getByRole('button', { name: 'Choose 1 for interview' }).click();
  await expect(
    page.getByText('1 person chosen for interview. They are on the Interviews page, not scheduled yet.'),
  ).toBeVisible();
  // Once chosen, the one primary action is "Add to decision pack"; "Start interview" is beside it.
  await expect(page.getByRole('button', { name: 'Add to decision pack' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Choose for interview' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Start interview' })).toBeVisible();

  // The job's Interviews tab lists him; scheduling contacts nobody.
  await page.goto(interviewsTab());
  const daniel = page.getByRole('table', { name: 'Interviews' }).getByRole('row').filter({ hasText: 'Daniel Novak' });
  await expect(daniel.getByRole('cell').nth(1)).toHaveText('Round 1');
  await expect(daniel).toContainText('Not scheduled yet');
  await expect(() => daniel.getByRole('button', { name: 'Schedule Daniel Novak' }).click({ timeout: 1000 })).toPass();
  const dialog = page.getByRole('dialog', { name: 'Schedule Round 1' });
  await dialog.getByLabel('Date').fill(new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10));
  await dialog.getByLabel('Time (Asia/Dubai)').fill('11:00');
  await dialog.getByRole('button', { name: 'Schedule', exact: true }).click();
  await expect(page.getByText('Scheduled. Nobody has been contacted.')).toBeVisible();
  await expect(daniel).toContainText('Scheduled');
  // SAFETY: scheduling queued no message to anyone (AIV-P1-165 §12, §16).
  expect(await messagesQueued()).toBe(queued);

  // Scenario: A scheduled interview's scorecard can be opened, from the Interviews tab, by keyboard.
  const start = daniel.getByRole('button', { name: 'Start interview with Daniel Novak' });
  await start.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 1, name: 'Round 1 scorecard: Daniel Novak' })).toBeVisible();
  await expect(page).toHaveURL(/\/app\/interviews\/[0-9a-f-]{36}$/);

  // Scenario: Rate only what was tested. "Not shown" needs no note; "Cost and reliability" is left unrated.
  const retrieval = page.getByRole('radiogroup', { name: /^Your assessment ?: Retrieval and evaluation$/ });
  const notShown = retrieval.getByRole('radio', { name: 'Not shown' });
  // A key press before the page hydrates is lost, so it is repeated until the rating is taken.
  await expect(async () => {
    await notShown.focus();
    await page.keyboard.press('Space');
    await expect(notShown).toBeChecked({ timeout: 500 });
  }).toPass();
  // A claim already counts zero, so weakening it leaves the backed score where it was.
  await expect(page.getByText(/^Backed score stays \d+\.$/)).toBeVisible();
  const submit = page.getByRole('button', { name: 'Submit scorecard' });
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect(page.getByText('This scorecard is submitted. It can no longer change.')).toBeVisible();
  await expect(page.getByText(/^Write what you saw or heard before submitting/)).toHaveCount(0);
  expect(await messagesQueued()).toBe(queued);
});

test('Scenario: "Start interview" from the profile opens the scorecard', async ({ page }) => {
  await signIn(page, { email: creator });
  await openProfile(page, 'Priya Nair');
  await expect(async () => {
    await page.getByRole('button', { name: 'Choose for interview' }).click({ timeout: 1000 });
    await expect(preview(page)).toBeVisible({ timeout: 1000 });
  }).toPass();
  await preview(page).getByRole('button', { name: 'Choose 1 for interview' }).click();
  const start = page.getByRole('button', { name: 'Start interview' });
  await expect(start).toBeVisible();
  await start.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 1, name: 'Round 1 scorecard: Priya Nair' })).toBeVisible();
  // Started: her profile now offers the scorecard itself.
  await openProfile(page, 'Priya Nair');
  await expect(page.getByRole('link', { name: 'Open scorecard' })).toHaveAttribute(
    'href',
    /^\/app\/interviews\/[0-9a-f-]{36}$/,
  );
});

test('Scenario: Once chosen, "Add to decision pack" from the profile, after a preview', async ({ page }) => {
  await signIn(page, { email: creator });
  await openProfile(page, 'Daniel Novak');
  await expect(async () => {
    await page.getByRole('button', { name: 'Add to decision pack' }).click({ timeout: 1000 });
    await expect(preview(page)).toBeVisible({ timeout: 1000 });
  }).toPass();
  await expect(preview(page).getByRole('heading')).toHaveText('Preview: add 1 candidate to a decision pack');
  await expect(preview(page)).toContainText('Nothing changes until you confirm.');
  await preview(page).getByRole('textbox', { name: 'Pack name' }).fill('Round 2 shortlist');
  await preview(page).getByRole('button', { name: 'Add 1 to the pack' }).click();
  await expect(page.getByText('1 candidate added to Round 2 shortlist.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open the pack' })).toHaveAttribute(
    'href',
    new RegExp(`^/app/jobs/${jobId}/packs/[0-9a-f-]{36}$`),
  );
  // In a pack: nothing left to choose or add, so no primary button.
  await expect(page.getByRole('button', { name: /^(Add to decision pack|Choose for interview)$/ })).toHaveCount(0);
});

for (const theme of themes) {
  test(`axe passes with "Correct name" open, and Cancel changes nothing (${theme})`, async ({
    page,
    context,
    baseURL,
  }) => {
    await context.addCookies([{ name: 'theme', value: theme, url: baseURL ?? '' }]);
    await signIn(page, { email: creator });
    await openProfile(page, 'Maria Santo');
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    const dialog = page.getByRole('dialog', { name: "Correct the candidate's name" });
    await expect(async () => {
      await page.getByRole('button', { name: 'Correct name' }).click({ timeout: 1000 });
      await expect(dialog).toBeVisible({ timeout: 1000 });
    }).toPass();
    await expect(dialog.getByLabel('Name', { exact: true })).toHaveValue('Maria Santo');
    // A reason is required: nothing can be saved without one.
    await dialog.getByLabel('Name', { exact: true }).fill('Maria Santos');
    await expect(dialog.getByRole('button', { name: 'Save name' })).toBeDisabled();
    await expectAccessible(page);
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 1, name: 'Maria Santo', exact: true })).toBeVisible();
  });
}

// SAFETY: mutation check: `correctName` (the server action) skipped `getCandidates().correctName` and returned ok -> this
// test failed (the heading still read "Maria Santo").
test('Scenario: The recruiter can correct a name, audited, by keyboard', async ({ page }) => {
  await signIn(page, { email: creator });
  await openProfile(page, 'Maria Santo');
  const dialog = page.getByRole('dialog', { name: "Correct the candidate's name" });
  const open = page.getByRole('button', { name: 'Correct name' });
  await expect(async () => {
    await open.focus();
    await page.keyboard.press('Enter');
    await expect(dialog).toBeVisible({ timeout: 1000 });
  }).toPass();
  await dialog.getByLabel('Name', { exact: true }).fill('Maria Santos');
  await page.keyboard.press('Tab');
  await expect(dialog.getByLabel('Reason, recorded in the audit log')).toBeFocused();
  await page.keyboard.type('Typo in read name');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Save name' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(dialog).toHaveCount(0);

  // The new name shows everywhere for that candidate: here, on the ranking and to the candidate after her.
  await expect(page.getByRole('heading', { level: 1, name: 'Maria Santos', exact: true })).toBeVisible();
  await expect(page.getByText('Name corrected and recorded in the audit log.')).toBeVisible();
  // SAFETY: no name in the URL (AGENTS.md 1.2): opaque ids only.
  expect(page.url()).not.toMatch(/maria|santo/i);
  await page.goto(`/app/jobs/${jobId}/candidates`);
  const table = page.getByRole('table', { name: 'Ranked candidates' });
  await expect(table.getByRole('link', { name: 'Maria Santos', exact: true })).toBeVisible();
  await expect(table.getByRole('link', { name: 'Maria Santo', exact: true })).toHaveCount(0);

  // The audit log records the actor, the time and the reason, and neither name.
  const entries = await inWorkspace<{ actor_id: string; note: string; values: string; at: string }>(sql`
    select actor_id, note, coalesce(before::text, '') || coalesce(after::text, '') as values, occurred_at as at
      from audit.entry where action = 'candidate.renamed' and subject_id = ${person.get('Maria Santo') ?? ''}`);
  expect(entries).toHaveLength(1);
  expect(entries[0]).toMatchObject({ actor_id: creatorUserId, note: 'Typo in read name', values: '' });
  expect(Date.now() - new Date(entries[0]?.at ?? 0).getTime()).toBeLessThan(120_000);
});
