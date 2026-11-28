import { createAssessment } from '@credalent/assessment/composition';
import { createAudit } from '@credalent/audit/composition';
import { createCandidates, displayNamesInWorkspace } from '@credalent/candidates/composition';
import type { Db } from '@credalent/db';
import { createDb } from '@credalent/db/client';
import { createEvidence } from '@credalent/evidence/composition';
import type { EvidenceContract } from '@credalent/evidence';
import { createCandidateJobResolver, createIntake } from '@credalent/intake/composition';
import type { Competency } from '@credalent/jobs';
import { createApprovedRubricReads, createJobs } from '@credalent/jobs/composition';
import type { WorkspaceContext } from '@credalent/workspaces';
import { createWorkspaces } from '@credalent/workspaces/composition';
import type { Page } from '@playwright/test';
import { sql } from 'drizzle-orm';
import { receiveConfirmed } from '../confirmedBatch.ts';
import { databaseUrl } from '../playwright.config.ts';
import { signIn } from './auth.ts';
import { expect, test } from './csp.ts';
import { expectAccessible, themes } from './gallery.ts';
import { approvedWorkspace } from './workspaces.ts';

// AIV-P1-165 §7 and §11, AIV-P1-134, AIV-P1-156: six CVs added to "Senior AI Engineer" in this spec's own workspace
// (Ayesha Perera, admin; an approved rubric). Sara Al Qahtani is assessed; the other five are unnamed applicants whose
// CVs are being read (A, cv-a.pdf), unreadable (B), failed (C), waiting for the AI allowance (D) and read but not
// assessable (F, its mapping failed for good). States are set in the database as the worker leaves them; no worker runs.
// The e2e server has no storage account, so no file can be named there (getFiles() is null) and the rows read
// "Unnamed applicant": the file name standing in is proven by loadRanking.test.ts, loadProfile.test.ts, Ranking.test.tsx
// and CandidateProfile.test.tsx, its absence from the log by the mutation-checked test in loadRanking.test.ts.
// Serial: the refresh and the retry change A's and C's rows.
test.describe.configure({ mode: 'serial' });

let creator: string;
let creatorId: string;
let workspaceId: string;
let jobId: string;
const ids: Record<string, string> = {};
const sources: Record<string, string> = {};

const competency = (name: string, weightPercent: number): Competency => ({
  name,
  evidenceExpected: `Evidence of ${name.toLowerCase()}`,
  weightPercent,
  levelNeeded: 3,
  type: 'mandatory',
  origin: 'from_description',
});

/** The modules over the e2e database, and the creator's workspace transaction to run them in. */
function modules(db: Db, creatorUserId: string) {
  const audit = createAudit(db);
  const workspaces = createWorkspaces(db, audit);
  const jobs = createJobs(workspaces, audit);
  const applied = createCandidateJobResolver(jobs);
  return {
    jobs,
    intake: createIntake(workspaces, createCandidates(workspaces), jobs, displayNamesInWorkspace, audit),
    evidence: createEvidence(workspaces, audit, undefined, applied),
    assessment: createAssessment(workspaces, audit, jobs, undefined, applied),
    as: <T>(fn: (ctx: WorkspaceContext) => Promise<T>) =>
      workspaces.withWorkspace({ userId: creatorUserId }, workspaceId, fn),
  };
}

/** Records one cited repository excerpt for the candidate and assesses them, as the worker would after mapping. */
async function assess(m: ReturnType<typeof modules>, ctx: WorkspaceContext, candidateId: string) {
  const rubric = await createApprovedRubricReads().approvedRubric(ctx.tx, workspaceId, jobId);
  if (!rubric) throw new Error('The rubric was not approved.');
  await m.evidence.recordEvidence(ctx, {
    candidateId,
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
        competencies: [{ jobId, competencyId: rubric.competencies[0]?.id ?? '', level: 5 }],
      },
    ],
    synthetic: true,
  });
  await m.assessment.assessCandidate(ctx, {
    candidateId,
    jobId,
    rubric: { versionId: rubric.id, competencies: rubric.competencies },
    evidence: await m.evidence.listEvidenceForCandidate(ctx, candidateId, jobId),
  });
}

/** A CV uploaded under `fileName` and its parse, left at `status` as the worker leaves it. */
async function cvAt(evidence: EvidenceContract, ctx: WorkspaceContext, key: string, status: string) {
  const fileId = crypto.randomUUID();
  await ctx.tx.execute(sql`insert into files.file (id, workspace_id, purpose, content_type, file_name, size_bytes,
    status, blob_path, uploaded_by, created_at) values (${fileId}, ${workspaceId}, 'cv', 'application/pdf',
    ${`cv-${key.toLowerCase()}.pdf`}, 2048, 'clean', ${`cvs/w/${workspaceId}/${fileId}`}, ${ctx.userId}, now())`);
  const { sourceId } = await evidence.requestCvParse(ctx, { candidateId: ids[key] ?? '', fileId, synthetic: true });
  await ctx.tx.execute(sql`update evidence.cv_parse set status = ${status} where source_id = ${sourceId}`);
  sources[key] = sourceId;
}

test.beforeAll(async () => {
  const stamp = Date.now();
  creator = `ap+cv-status-${stamp}@example.com`;
  const made = await approvedWorkspace(creator, `CV status ${stamp}`);
  workspaceId = made.workspaceId;
  creatorId = made.creatorUserId;
  const db = createDb(databaseUrl, { max: 1 });
  try {
    const m = modules(db, made.creatorUserId);
    await m.as(async (ctx) => {
      const job = await m.jobs.createJob(ctx, {
        title: 'Senior AI Engineer',
        jobType: 'ai_llm_engineering',
        description: 'Senior AI Engineer, synthetic e2e job for CV statuses.',
        synthetic: true,
      });
      jobId = job.id;
      const saved = await m.jobs.saveRubric(ctx, job.id, {
        successStatement: 'Ships reliable AI features.',
        competencies: [competency('Python service engineering', 60), competency('Retrieval and evaluation', 40)],
      });
      const sent = await m.jobs.submitRubric(ctx, saved.id);
      await m.jobs.approveRubric(ctx, sent.id, sent.revision);
      for (const [i, key] of ['Sara', 'A', 'B', 'C', 'D', 'F'].entries()) {
        const { personId } = await receiveConfirmed(m.intake, ctx, {
          jobId: job.id,
          person: {
            displayName: key === 'Sara' ? 'Sara Al Qahtani' : 'Unnamed applicant',
            identifiers: [{ type: 'cv_hash', value: `${stamp}${i}`.padStart(64, '0') }],
            synthetic: true,
          },
          source: 'linkedin',
          fileIds: [crypto.randomUUID()],
        });
        ids[key] = personId;
      }
      await assess(m, ctx, ids['Sara'] ?? '');
      // Sara's newest mapping run could not cite one line of her CV (AIV-P1-156).
      await ctx.tx.execute(sql`insert into evidence.mapping (id, workspace_id, candidate_id, job_id, rubric_version_id,
        prompt_version, model, changes, uncited_link_count, created_at) select gen_random_uuid(), ${workspaceId},
        ${ids['Sara']}, ${jobId}, id, 'evidence.mapToCompetency@4', 'gpt-4.1-mini', '[]'::jsonb, 1, now()
        from jobs.rubric_version where job_id = ${jobId} and status = 'approved'`);
      await cvAt(m.evidence, ctx, 'A', 'pending');
      await cvAt(m.evidence, ctx, 'B', 'unreadable');
      await cvAt(m.evidence, ctx, 'C', 'failed');
      await cvAt(m.evidence, ctx, 'D', 'waiting');
      await cvAt(m.evidence, ctx, 'F', 'parsed');
      await ctx.tx.execute(sql`insert into evidence.mapping_failure (workspace_id, candidate_id, job_id, failed_at)
        values (${workspaceId}, ${ids['F']}, ${jobId}, now())`);
    });
  } finally {
    await db.$client.end();
  }
});

const table = (page: Page) => page.getByRole('table', { name: 'Ranked candidates' });
const row = (page: Page, name: string) => table(page).getByRole('row').filter({ hasText: name });

async function openRanking(page: Page) {
  await signIn(page, { email: creator });
  await page.goto(`/app/jobs/${jobId}/candidates`);
  await expect(page).toHaveTitle('Senior AI Engineer: Evidence and ranking · Credalent', { timeout: 15_000 });
}

test('Scenario: Each row says its own status, the footer counts every row, a banner counts those in progress', async ({
  page,
}) => {
  await openRanking(page);
  await expect(row(page, 'Reading the CV…')).toHaveCount(1);
  await expect(row(page, 'Could not be read automatically')).toHaveCount(1);
  await expect(row(page, 'We could not read this CV. Try again.')).toHaveCount(1);
  await expect(row(page, "Waiting for tomorrow's AI allowance")).toHaveCount(1);
  await expect(row(page, 'We could not assess this CV. Try again.')).toHaveCount(1);
  await expect(table(page)).not.toContainText('Not yet scored');
  // "Try again" only where it can help: the failed read and the failed assessment.
  await expect(table(page).getByRole('button', { name: /^Try again for / })).toHaveCount(2);
  await expect(
    row(page, 'We could not read this CV. Try again.').getByRole('button', { name: /^Try again/ }),
  ).toHaveCount(1);
  await expect(page.getByText(/^1 of 6 assessed\./)).toBeVisible();
  await expect(page.getByText('Assessing 1 CV')).toBeVisible();
});

for (const theme of themes) {
  test(`axe passes on the ranking with every CV status (${theme})`, async ({ page, context, baseURL }) => {
    await context.addCookies([{ name: 'theme', value: theme, url: baseURL ?? '' }]);
    await openRanking(page);
    await expect(table(page).getByRole('button', { name: /^Try again for / })).toHaveCount(2);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await expectAccessible(page);
  });
}

test('Scenario: The ranking and an open profile refresh on their own when CV A finishes scoring', async ({
  page,
  context,
}) => {
  await openRanking(page);
  const profile = await context.newPage();
  await profile.goto(`/app/candidates/${ids['A']}?job=${jobId}`);
  await expect(profile.getByRole('heading', { level: 1 })).toHaveText('Unnamed applicant');
  await expect(profile.getByText('Reading the CV…')).toBeVisible();

  // The worker reads the CV, names the applicant and assesses them, while both pages stay open.
  const db = createDb(databaseUrl, { max: 1 });
  try {
    const m = modules(db, creatorId);
    await m.as(async (ctx) => {
      await ctx.tx.execute(sql`update evidence.cv_parse set status = 'parsed' where source_id = ${sources['A']}`);
      await ctx.tx.execute(sql`update candidates.person set display_name = 'Daniel Novak' where id = ${ids['A']}`);
      await assess(m, ctx, ids['A'] ?? '');
    });
  } finally {
    await db.$client.end();
  }

  // No reload: each page refreshes itself while a CV is read.
  await expect(page.getByText(/^2 of 6 assessed\./)).toBeVisible({ timeout: 20_000 });
  await expect(row(page, 'Daniel Novak').getByRole('img', { name: /backed by evidence/ })).toBeVisible();
  await expect(page.getByText(/^Assessing \d+ CVs?$/)).toHaveCount(0);
  await expect(profile.getByRole('heading', { level: 1 })).toHaveText('Daniel Novak', { timeout: 20_000 });
  await expect(profile.getByText(/backed by evidence/).first()).toBeVisible();
});

test('Scenario: "Try again" on a failed CV, by keyboard, reads that CV again', async ({ page }) => {
  await openRanking(page);
  const failed = 'We could not read this CV. Try again.';
  await row(page, failed)
    .getByRole('button', { name: /^Try again/ })
    .focus();
  await page.keyboard.press('Enter');
  await expect(row(page, failed)).toHaveCount(0);
  await expect(row(page, 'Reading the CV…')).toHaveCount(1);
  await expect(table(page).getByRole('button', { name: /^Try again for / })).toHaveCount(1);
});

for (const theme of themes) {
  test(`Scenario: the profile of a CV that could not be assessed offers "Try again"; axe (${theme})`, async ({
    page,
    context,
    baseURL,
  }) => {
    await context.addCookies([{ name: 'theme', value: theme, url: baseURL ?? '' }]);
    await signIn(page, { email: creator });
    await page.goto(`/app/candidates/${ids['F']}?job=${jobId}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Unnamed applicant');
    await expect(page.getByText('We could not assess this CV. Try again.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Try again for Unnamed applicant' })).toBeVisible();
    await expectAccessible(page);
  });

  test(`Scenario: the profile says how many CV lines could not be cited; axe (${theme})`, async ({
    page,
    context,
    baseURL,
  }) => {
    await context.addCookies([{ name: 'theme', value: theme, url: baseURL ?? '' }]);
    await signIn(page, { email: creator });
    await page.goto(`/app/candidates/${ids['Sara']}?job=${jobId}`);
    await expect(
      page.getByText(
        'One line from this CV could not be cited, so it was not mapped. The CV is unchanged. Read it in full for them.',
      ),
    ).toBeVisible();
    await expectAccessible(page);
  });
}
