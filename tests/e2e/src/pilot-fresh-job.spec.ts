import { createAssessment } from '@credalent/assessment/composition';
import { createAudit } from '@credalent/audit/composition';
import { createCandidates, displayNamesInWorkspace } from '@credalent/candidates/composition';
import { withWorkspace } from '@credalent/db';
import { createDb } from '@credalent/db/client';
import { createDecisions } from '@credalent/decisions/composition';
import { createEvidence } from '@credalent/evidence/composition';
import { createCandidateJobResolver, createIntake } from '@credalent/intake/composition';
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

// AIV-P1-165, the pilot path on a fresh job: CVs only, so every backed score is 0 (a claim counts zero, AGENTS.md 1.6),
// and no hiring owner, so the admin recruiter records the decision herself (owner decision (b)). §9 "When every backed
// score is 0, one plain banner says so" and §13 "A decision can be recorded on the pilot path". Its own workspace, seeded
// through the contracts as record-decisions.spec.ts does. Serial: the recording test comes after the ones that need the
// job ownerless and the pack undecided.
test.describe.configure({ mode: 'serial' });

/** Each with one CV claim at this level: the "up to" order is Daniel, Priya, Maria. */
const CAST = [
  ['Maria Santos', 3],
  ['Priya Nair', 4],
  ['Daniel Novak', 5],
] as const;
const NAMING = 'Solo recruiter: I decide this hire';
const WHY = 'Strongest inspected evaluation work';
let admin: string;
let adminId: string;
let recruiter: string;
let workspaceId: string;
let rankingPath: string;
let packPath: string;

test.beforeAll(async () => {
  const stamp = Date.now();
  admin = `ayesha+fresh-${stamp}@example.com`;
  recruiter = `alex+fresh-${stamp}@example.com`;
  const made = await approvedWorkspace(admin, `Fresh ${stamp}`);
  workspaceId = made.workspaceId;
  adminId = made.creatorUserId;
  const db = createDb(databaseUrl, { max: 1 });
  try {
    const recruiterId = await syntheticUser(db, recruiter);
    const audit = createAudit(db);
    const workspaces = createWorkspaces(db, audit);
    const jobs = createJobs(workspaces, audit);
    const applied = createCandidateJobResolver(jobs);
    const intake = createIntake(workspaces, createCandidates(workspaces), jobs, displayNamesInWorkspace, audit);
    const evidence = createEvidence(workspaces, audit, undefined, applied);
    const assessment = createAssessment(workspaces, audit, jobs, undefined, applied);
    const decisions = createDecisions(workspaces, jobs, assessment, audit);
    await workspaces.withWorkspace({ userId: adminId }, workspaceId, async (ctx) => {
      await ctx.tx.execute(
        sql`insert into workspaces.member (workspace_id, user_id, role, status)
          values (${workspaceId}, ${recruiterId}, 'recruiter', 'active')`,
      );
      // No hiring owner: the admin approves the rubric as its recruiter (ADR-014).
      const job = await jobs.createJob(ctx, {
        title: 'Senior AI Engineer',
        jobType: 'ai_llm_engineering',
        description: 'Senior AI Engineer, synthetic e2e job on the pilot path with CVs only.',
        synthetic: true,
      });
      const saved = await jobs.saveRubric(ctx, job.id, {
        successStatement: 'Ships reliable AI features.',
        competencies: [
          {
            name: 'LLM evaluation',
            evidenceExpected: 'Evidence of evaluating LLM output',
            weightPercent: 100,
            levelNeeded: 3,
            type: 'mandatory',
            origin: 'from_description',
          },
        ],
      });
      const sent = await jobs.submitRubric(ctx, saved.id);
      await jobs.approveRubric(ctx, sent.id, sent.revision);
      const rubric = await createApprovedRubricReads().approvedRubric(ctx.tx, workspaceId, job.id);
      if (!rubric) throw new Error('The rubric was not approved.');
      let daniel = '';
      for (const [i, [name, level]] of CAST.entries()) {
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
        await evidence.recordEvidence(ctx, {
          candidateId: personId,
          source: {
            kind: 'cv',
            label: 'CV',
            url: null,
            blobFileId: null,
            capturedAt: new Date('2026-11-10T08:00:00.000Z'),
            checkedAt: null,
            checkMethod: null,
          },
          items: [
            {
              excerpt: 'built the evaluation harness for the support assistant',
              excerptSpan: null,
              provenance: 'claim',
              strength: 'supporting',
              limit: 'A line in the CV; nothing to inspect yet.',
              competencies: [{ jobId: job.id, competencyId: rubric.competencies[0]?.id ?? '', level }],
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
        if (name === 'Daniel Novak') daniel = personId;
      }
      const { packId } = await decisions.createPack(ctx, {
        reason: 'Shortlist for the hiring decision',
        jobId: job.id,
        name: 'Round 2 shortlist',
        members: [{ candidateId: daniel }],
      });
      rankingPath = `/app/jobs/${job.id}/candidates`;
      packPath = `/app/jobs/${job.id}/packs/${packId}`;
    });
  } finally {
    await db.$client.end();
  }
});

/** The audit entries this path writes, and anything that could reach someone, in this spec's workspace. */
async function stored() {
  const db = createDb(databaseUrl, { max: 1 });
  try {
    return await withWorkspace(db, workspaceId, async (tx) => ({
      decisions: (await tx.execute<{ decision: string }>(sql`select decision from decisions.decision`)).map(
        (row) => row.decision,
      ),
      audited: (
        await tx.execute<{ action: string; actor_id: string; note: string }>(
          sql`select action, actor_id, note from audit.entry
            where action in ('job.hiring_owner_changed', 'decision.recorded') order by occurred_at`,
        )
      ).map((row) => ({ action: row.action, actorId: row.actor_id, note: row.note })),
      emails: Number((await tx.execute<{ n: number }>(sql`select count(*)::int as n from notifications.outbox`))[0]?.n),
    }));
  } finally {
    await db.$client.end();
  }
}

const BANNER = 'No one has inspected work yet. Ordered by what their CVs claim, which is not verified.';

async function openRanking(page: Page) {
  await signIn(page, { email: admin });
  await page.goto(rankingPath);
  await expect(page).toHaveTitle('Senior AI Engineer: Evidence and ranking · Credalent');
  const table = page.getByRole('table', { name: 'Ranked candidates' });
  await expect(table.getByRole('checkbox', { name: /^Select [A-Z]/ })).toHaveCount(CAST.length);
  return table;
}

async function openPack(page: Page, email: string) {
  await signIn(page, { email });
  await page.goto(packPath);
  await expect(page.getByRole('heading', { level: 2, name: 'Round 2 shortlist: Senior AI Engineer' })).toBeVisible();
}
const nameSelf = (page: Page) => page.getByRole('button', { name: 'Record decisions yourself' });
const record = (page: Page) => page.getByRole('button', { name: 'Record decisions', exact: true });

// SAFETY: mutation check: filtered rows with backed score 0 out of useRankingController's matching rows -> this test
// failed (0 of 3 rows listed)
test('Scenario: When every backed score is 0, one plain banner says so, and every candidate stays visible', async ({
  page,
}) => {
  const table = await openRanking(page);
  await expect(page.getByText(BANNER, { exact: true })).toHaveCount(1);
  // The order label states the rule actually used: claims, then who was assessed first.
  await expect(page.getByText(/^Ordered by the "up to" score, which rests on claims/)).toBeVisible();
  // Every candidate listed, none disabled, in "up to" order.
  const rows = table.getByRole('checkbox', { name: /^Select [A-Z]/ });
  for (const [i, name] of ['Daniel Novak', 'Priya Nair', 'Maria Santos'].entries()) {
    await expect(rows.nth(i)).toHaveAccessibleName(`Select ${name}`);
    await expect(rows.nth(i)).toBeEnabled();
  }
});

for (const theme of themes) {
  test(`axe passes on the ranking with the all-zero banner (${theme})`, async ({ page, context, baseURL }) => {
    await context.addCookies([{ name: 'theme', value: theme, url: baseURL ?? '' }]);
    await openRanking(page);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await expect(page.getByText(BANNER, { exact: true })).toBeVisible();
    await expectAccessible(page);
  });
}

test('Scenario: anyone else sees why they cannot record, with no button that fails silently', async ({ page }) => {
  await openPack(page, recruiter);
  await expect(page.getByText('Only the hiring owner can record decisions.')).toBeVisible();
  await expect(nameSelf(page)).toHaveCount(0);
  await expect(record(page)).toHaveCount(0);
});

for (const theme of themes) {
  test(`axe passes on "Record decisions yourself" and its preview (${theme})`, async ({ page, context, baseURL }) => {
    await context.addCookies([{ name: 'theme', value: theme, url: baseURL ?? '' }]);
    await openPack(page, admin);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await expect(
      page.getByText(
        "This job has no hiring owner yet. Only the job's hiring owner records decisions, and as an admin you can name yourself.",
      ),
    ).toBeVisible();
    await expectAccessible(page);
    await expect(async () => {
      await nameSelf(page).click({ timeout: 1000 });
      await expect(page.getByRole('region', { name: "Preview: become this job's hiring owner" })).toBeVisible({
        timeout: 500,
      });
    }).toPass();
    await expectAccessible(page);
  });
}

test('Scenario: A decision can be recorded on the pilot path, by keyboard, and nobody is contacted', async ({
  page,
}) => {
  const before = await stored();
  expect(before).toEqual({ decisions: [], audited: [], emails: 0 });
  await openPack(page, admin);
  await expect(record(page)).toHaveCount(0);

  // Name herself the job's hiring owner, after a preview with a reason.
  const naming = page.getByRole('region', { name: "Preview: become this job's hiring owner" });
  await expect(async () => {
    await nameSelf(page).focus();
    await page.keyboard.press('Enter');
    await expect(naming).toBeVisible({ timeout: 500 });
  }).toPass();
  await expect(naming).toContainText('Nothing changes until you confirm.');
  await expect(naming.getByRole('textbox', { name: /^Reason/ })).toBeFocused();
  await page.keyboard.type(NAMING);
  await page.keyboard.press('Tab');
  await expect(naming.getByRole('button', { name: 'Become hiring owner' })).toBeFocused();
  await page.keyboard.press('Enter');

  // The page reads again and offers her the decision.
  const advance = page
    .getByRole('radiogroup', { name: 'Your decision for Daniel Novak' })
    .getByRole('radio', { name: 'Advance to Round 2' });
  await expect(advance).toBeEnabled();
  await expect(nameSelf(page)).toHaveCount(0);
  await expect(async () => {
    await advance.focus();
    await page.keyboard.press('Space');
    await expect(advance).toBeChecked({ timeout: 250 });
  }).toPass();
  await record(page).focus();
  await page.keyboard.press('Enter');
  const preview = page.getByRole('region', { name: 'Preview: record 1 decision' });
  await expect(preview).toContainText('Nothing changes until you confirm.');
  await expect(preview.getByRole('textbox', { name: /^Reason/ })).toBeFocused();
  await page.keyboard.type(WHY);
  await page.keyboard.press('Tab');
  await expect(preview.getByRole('button', { name: 'Record 1 decision' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('status').filter({ hasText: 'Decisions recorded by you' })).toBeVisible();

  // Saved, audited with her as the actor and each reason, and no email queued for anyone.
  expect(await stored()).toEqual({
    decisions: ['advance'],
    audited: [
      { action: 'job.hiring_owner_changed', actorId: adminId, note: NAMING },
      { action: 'decision.recorded', actorId: adminId, note: WHY },
    ],
    emails: 0,
  });
});
