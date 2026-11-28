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

// AIV-P2-012, the J3 step "record decisions": the Head of Engineering, hiring owner named on Senior AI Engineer, records
// a decision for each of the three people in "Round 2 shortlist: Senior AI Engineer", by keyboard, after a preview. Its
// own workspace, so nothing another spec reads changes: the recruiter who prepared the pack sees the choices read-only,
// a hiring owner granted only another job is refused the page. The stage change runs in the worker (intake's
// DecisionsRecorded.v1 consumer), which this app does not run: tests/integration/src/record-decisions.test.ts proves it.
// Serial: the recording test comes after the ones that need the pack undecided.
test.describe.configure({ mode: 'serial' });

const NAMES = ['Sara Al Qahtani', 'Arjun Menon', 'Huda Al Mansoori'];
const WHY = 'Strong on the heaviest competency; probe cost in Round 2.';
let recruiter: string;
let owner: string;
let otherOwner: string;
let workspaceId: string;
let packPath: string;

test.beforeAll(async () => {
  const stamp = Date.now();
  recruiter = `alex+decide-${stamp}@example.com`;
  owner = `hassan+decide-${stamp}@example.com`;
  otherOwner = `faisal+decide-${stamp}@example.com`;
  const made = await approvedWorkspace(recruiter, `Decide ${stamp}`);
  workspaceId = made.workspaceId;
  const db = createDb(databaseUrl, { max: 1 });
  try {
    const ownerId = await syntheticUser(db, owner);
    const otherOwnerId = await syntheticUser(db, otherOwner);
    const audit = createAudit(db);
    const workspaces = createWorkspaces(db, audit);
    const jobs = createJobs(workspaces, audit);
    const applied = createCandidateJobResolver(jobs);
    const intake = createIntake(workspaces, createCandidates(workspaces), jobs, displayNamesInWorkspace, audit);
    const evidence = createEvidence(workspaces, audit, undefined, applied);
    const assessment = createAssessment(workspaces, audit, jobs, undefined, applied);
    const decisions = createDecisions(workspaces, jobs, assessment, audit);
    await workspaces.withWorkspace({ userId: made.creatorUserId }, made.workspaceId, async (ctx) => {
      await ctx.tx.execute(
        sql`insert into workspaces.member (workspace_id, user_id, role, status) values
          (${made.workspaceId}, ${ownerId}, 'hiring_owner', 'active'),
          (${made.workspaceId}, ${otherOwnerId}, 'hiring_owner', 'active')`,
      );
      const job = await jobs.createJob(ctx, {
        title: 'Senior AI Engineer',
        jobType: 'ai_llm_engineering',
        description: 'Senior AI Engineer, synthetic e2e job for recording decisions.',
        synthetic: true,
        hiringOwnerUserId: ownerId,
      });
      await workspaces.grantJobAccess(ctx, { userId: ownerId, jobId: job.id });
      const other = await jobs.createJob(ctx, {
        title: 'Platform Engineer',
        jobType: 'ai_llm_engineering',
        description: 'Platform Engineer, synthetic e2e job a hiring owner is granted instead.',
        synthetic: true,
      });
      await workspaces.grantJobAccess(ctx, { userId: otherOwnerId, jobId: other.id });
      const saved = await jobs.saveRubric(ctx, job.id, {
        successStatement: 'Ships reliable AI features.',
        competencies: [
          {
            name: 'Python service engineering',
            evidenceExpected: 'Evidence of python service engineering',
            weightPercent: 100,
            levelNeeded: 3,
            type: 'mandatory',
            origin: 'from_description',
          },
        ],
      });
      const sent = await jobs.submitRubric(ctx, saved.id);
      await jobs.approveRubric(ctx, sent.id, sent.revision);
      const rubric = await createApprovedRubricReads().approvedRubric(ctx.tx, made.workspaceId, job.id);
      if (!rubric) throw new Error('The rubric was not approved.');
      const members: { candidateId: string }[] = [];
      for (const [i, name] of NAMES.entries()) {
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
              competencies: [{ jobId: job.id, competencyId: rubric.competencies[0]?.id ?? '', level: 4 }],
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
        members.push({ candidateId: personId });
      }
      const { packId } = await decisions.createPack(ctx, {
        reason: 'Shortlist for the hiring decision',
        jobId: job.id,
        name: 'Round 2 shortlist',
        members,
      });
      packPath = `/app/jobs/${job.id}/packs/${packId}`;
    });
  } finally {
    await db.$client.end();
  }
});

/** What the decisions wrote, and anything that could reach a candidate, in this spec's workspace. */
async function stored() {
  const db = createDb(databaseUrl, { max: 1 });
  try {
    return await withWorkspace(db, workspaceId, async (tx) => {
      const n = async (query: ReturnType<typeof sql>) => Number((await tx.execute<{ n: number }>(query))[0]?.n);
      return {
        decisions: await n(sql`select count(*)::int as n from decisions.decision`),
        audited: await n(sql`select count(*)::int as n from audit.entry where action = 'decision.recorded'`),
        messages: await n(sql`select count(*)::int as n from notifications.message`),
        emails: await n(sql`select count(*)::int as n from notifications.outbox`),
      };
    });
  } finally {
    await db.$client.end();
  }
}

async function openPack(page: Page, email: string) {
  await signIn(page, { email });
  await page.goto(packPath);
  await expect(page.getByRole('heading', { level: 2, name: 'Round 2 shortlist: Senior AI Engineer' })).toBeVisible();
}
const group = (page: Page, name: string) => page.getByRole('radiogroup', { name: `Your decision for ${name}` });
const record = (page: Page) => page.getByRole('button', { name: 'Record decisions' });

test('Scenario: Only the authorised hiring owner: the recruiter sees the choices read-only, with no way to record', async ({
  page,
}) => {
  await openPack(page, recruiter);
  await expect(page.getByText('Only the hiring owner can record decisions.')).toBeVisible();
  for (const name of NAMES) {
    await expect(group(page, name).getByRole('radio')).toHaveCount(3);
    for (const radio of await group(page, name).getByRole('radio').all()) {
      await expect(radio).toBeDisabled();
      await expect(radio).not.toBeChecked();
    }
  }
  await expect(record(page)).toHaveCount(0);
});

test('a hiring owner granted only another job gets the 403 page, not the pack', async ({ page }) => {
  await signIn(page, { email: otherOwner });
  await page.goto(packPath);
  await expect(page.getByText('You do not have access to this. Ask your workspace admin.')).toBeVisible();
  await expect(page.getByText('Sara Al Qahtani')).toHaveCount(0);
  await expect(record(page)).toHaveCount(0);
});

for (const theme of themes) {
  test(`axe passes on the decision section with its errors shown (${theme})`, async ({ page, context, baseURL }) => {
    await context.addCookies([{ name: 'theme', value: theme, url: baseURL ?? '' }]);
    await openPack(page, owner);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await expect(async () => {
      await record(page).click({ timeout: 1000 });
      await expect(page.getByText('Choose a decision for Sara Al Qahtani')).toBeVisible({ timeout: 500 });
    }).toPass();
    await expectAccessible(page);
  });
}

test('Scenarios: Record decisions, Every candidate needs a choice, No candidate is contacted, by keyboard', async ({
  page,
}) => {
  const before = await stored();
  expect(before.decisions).toBe(0);
  await openPack(page, owner);
  // Nothing is chosen for anyone at first: Credalent's recommendation decides nothing.
  for (const name of NAMES)
    for (const radio of await group(page, name).getByRole('radio').all()) await expect(radio).not.toBeChecked();
  // Space chooses the focused option; arrow keys would move within the group.
  for (const name of NAMES.slice(0, 2)) {
    const advance = group(page, name).getByRole('radio', { name: 'Advance to Round 2' });
    await expect(async () => {
      await advance.focus();
      await page.keyboard.press('Space');
      await expect(advance).toBeChecked({ timeout: 250 });
    }).toPass();
  }
  await record(page).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByText('Choose a decision for Huda Al Mansoori')).toBeVisible();
  await expect(page.getByRole('region', { name: /^Preview/ })).toHaveCount(0);
  expect((await stored()).decisions).toBe(0);

  const huda = group(page, 'Huda Al Mansoori').getByRole('radio', { name: 'Advance to Round 2' });
  await huda.focus();
  await page.keyboard.press('Space');
  await expect(huda).toBeChecked();
  await record(page).focus();
  await page.keyboard.press('Enter');
  const preview = page.getByRole('region', { name: 'Preview: record 3 decisions' });
  await expect(preview.getByText('Advance to Round 2. The stage becomes Round 2 shortlist.')).toHaveCount(3);
  await expect(preview).toContainText('Nothing changes until you confirm.');
  // Focus moved to the required reason; Tab reaches Confirm.
  await expect(preview.getByRole('textbox', { name: /^Reason/ })).toBeFocused();
  await page.keyboard.type(WHY);
  await page.keyboard.press('Tab');
  await expect(preview.getByRole('button', { name: 'Record 3 decisions' })).toBeFocused();
  await page.keyboard.press('Enter');

  await expect(page.getByRole('status').filter({ hasText: 'Decisions recorded by you' })).toHaveText(
    /^Decisions recorded by you on \d{1,2} [A-Z][a-z]{2} \d{4} and added to the audit trail\. Schedule Round 2 interviews$/,
  );
  await expect(page.getByRole('link', { name: 'Schedule Round 2 interviews' })).toBeVisible();
  // Three decisions, each audited; no email or message to any candidate.
  expect(await stored()).toEqual({ ...before, decisions: 3, audited: 3 });
});

test('Scenario: Already decided: reopened, the decisions are read-only with who recorded them and when', async ({
  page,
}) => {
  await openPack(page, owner);
  const name = owner.slice(0, owner.indexOf('@'));
  await expect(
    page.getByText(new RegExp(`^Decisions recorded by ${name.replace('+', '\\+')} on \\d{1,2} [A-Z][a-z]{2} \\d{4}`)),
  ).toBeVisible();
  for (const person of NAMES) {
    const advance = group(page, person).getByRole('radio', { name: 'Advance to Round 2' });
    await expect(advance).toBeChecked();
    await expect(advance).toBeDisabled();
  }
  await expect(record(page)).toHaveCount(0);
});
