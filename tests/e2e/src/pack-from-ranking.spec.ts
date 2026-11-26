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
import { css, expectAccessible, themes } from './gallery.ts';
import { approvedWorkspace, syntheticUser } from './workspaces.ts';

// AIV-P2-010, a step of J3: the recruiter builds a decision pack from the ranking, after a preview, and opens it. This
// spec has a workspace of its own, so a pack changes nothing another spec reads: a Senior AI Engineer job with an
// approved rubric, Sara Al Qahtani, Arjun Menon, Huda Al Mansoori and Daniel Novak assessed from real evidence at 55
// each (the formula's numbers, not the ticket's illustrative 68, 64 and 61), and Maria Santos not yet scored; and an
// interviewer granted the job, who may not see its packs. AIV-P1-116 adds the pack's preview as the hiring owner sees
// it, Sara's stored email and phone that it must leave out, and a hiring owner granted only another job, who is
// refused it. Serial: the later tests open the pack the first one builds.
test.describe.configure({ mode: 'serial' });

let creator: string;
let interviewer: string;
let otherOwner: string;
let workspaceId: string;
let workspaceName: string;
let jobId: string;
let packPath: string;
const ASSESSED = ['Sara Al Qahtani', 'Arjun Menon', 'Huda Al Mansoori', 'Daniel Novak'];
const SARA_EMAIL = 'sara.alqahtani@example.com';
const SARA_PHONE = '+971500000116';

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
  otherOwner = `hana+pack-${stamp}@example.com`;
  workspaceName = `Pack ${stamp}`;
  const made = await approvedWorkspace(creator, workspaceName);
  workspaceId = made.workspaceId;
  const db = createDb(databaseUrl, { max: 1 });
  try {
    const interviewerId = await syntheticUser(db, interviewer);
    const otherOwnerId = await syntheticUser(db, otherOwner);
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
      const other = await jobs.createJob(ctx, {
        title: 'Platform Engineer',
        jobType: 'ai_llm_engineering',
        description: 'Platform Engineer, synthetic e2e job a hiring owner is granted instead.',
        synthetic: true,
      });
      await ctx.tx.execute(
        sql`insert into workspaces.member (workspace_id, user_id, role, status)
          values (${made.workspaceId}, ${otherOwnerId}, 'hiring_owner', 'active')`,
      );
      await workspaces.grantJobAccess(ctx, { userId: otherOwnerId, jobId: other.id });
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
            identifiers: [
              { type: 'cv_hash', value: `${stamp}${i}`.padStart(64, '0') },
              // AIV-P1-116: Sara's contact details are stored, so the preview is shown to leave them out.
              ...(i === 0
                ? [
                    { type: 'email' as const, value: SARA_EMAIL },
                    { type: 'phone' as const, value: SARA_PHONE },
                  ]
                : []),
            ],
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
  packPath = new URL(page.url()).pathname;
  await expect(page.getByText(/^Decision pack · prepared \d{1,2} [A-Z][a-z]{2} \d{4} · rubric v1$/)).toBeVisible();
  for (const name of ASSESSED) await expect(page.getByRole('link', { name })).toHaveCount(1);
  // AIV-P1-139: who added each member and when, the three from the new pack and Daniel alike.
  const addedBy = `Added by ${creator.slice(0, creator.indexOf('@'))} on `;
  await expect(page.getByText(addedBy)).toHaveCount(4);
  await expect(page.getByText(/^Added by .+ on \d{1,2} [A-Z][a-z]{2} \d{4}$/)).toHaveCount(4);
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

// AIV-P1-116: the pack as the hiring owner will see it, in the workspace's branding, inside Credalent only.
const shortlist = (page: Page) => page.getByRole('article', { name: 'Round 2 shortlist: Senior AI Engineer' });

async function openPreview(page: Page) {
  await signIn(page, { email: creator });
  await page.goto(packPath);
  const open = page.getByRole('link', { name: 'Preview as the hiring owner sees it' });
  await open.focus();
  await page.keyboard.press('Enter');
  await expect(shortlist(page)).toBeVisible();
  expect(new URL(page.url()).pathname).toBe(`${packPath}/preview`);
}

/** What leaving Credalent would write: a message to send and a stored file, in this spec's workspace. */
async function sentAndStored() {
  const db = createDb(databaseUrl, { max: 1 });
  try {
    return await withWorkspace(db, workspaceId, async (tx) => ({
      messages: [...(await tx.execute(sql`select count(*)::int as n from notifications.message`))],
      files: [...(await tx.execute(sql`select count(*)::int as n from files.file`))],
    }));
  } finally {
    await db.$client.end();
  }
}

test('AIV-P1-116 Scenario: Open the preview, by keyboard: each person, score and basis, strengths, risks and cited summary', async ({
  page,
}) => {
  await openPreview(page);
  const view = shortlist(page);
  // Branding: the workspace's name and its mark (initials on the default accent: no logo is stored yet, AIV-P2-077).
  const header = view.locator('header');
  await expect(header).toContainText(workspaceName);
  await expect(header).toContainText(/^P\d/);
  await expect(header.getByText(/^Prepared \d{1,2} [A-Z][a-z]{2} \d{4} · Confidential$/)).toBeVisible();
  await expect(view.getByText('Powered by Credalent')).toBeVisible();
  await expect(view.getByText('Observed', { exact: true })).toBeVisible();
  for (const name of ASSESSED) {
    const card = view.getByRole('region', { name });
    await expect(card.getByRole('img', { name: /^55 backed by evidence · up to \d+ if claims hold$/ })).toBeVisible();
    await expect(card.getByRole('list', { name: 'Backed by evidence' }).getByRole('listitem')).toHaveText([
      /^Python service engineering/,
    ]);
    await expect(card.getByRole('list', { name: 'Still to test in the interview' }).getByRole('listitem')).toHaveText([
      /^Cost and reliability.*3 short$/,
      /^Retrieval and evaluation.*3 short, claimed$/,
    ]);
    await expect(card.getByText("Credalent's summary")).toBeVisible();
    await expect(card.locator('mark').filter({ hasText: 'authored 301 of 340 commits' }).first()).toBeVisible();
    await expect(card.getByText('Source: rag-service').first()).toBeVisible();
    await expect(card.getByText('Summary generated without AI')).toBeVisible();
  }
  // Maria Santos is not in the pack.
  await expect(view.getByRole('region', { name: 'Maria Santos' })).toHaveCount(0);
});

// SAFETY: mutation check: rendered "sara.alqahtani@example.com" under each name in PackPreview -> this test failed
test('AIV-P1-116 Scenarios: No private data is shown, and Nothing leaves Credalent', async ({ page }) => {
  const before = await sentAndStored();
  await openPreview(page);
  await expect(shortlist(page).getByRole('region', { name: 'Sara Al Qahtani' })).toBeVisible();
  const text = await page.locator('body').innerText();
  // Sara's stored email and phone, and any email or international phone number at all.
  expect(text).not.toContain(SARA_EMAIL);
  expect(text.replace(/\D/g, '')).not.toContain(SARA_PHONE.slice(1));
  expect(text).not.toMatch(/[^\s@]+@[^\s@]+\.[^\s@]+/);
  expect(text).not.toMatch(/\+\d[\d\s().-]{7,}\d/);
  // No CV or evidence file, and no way to download, mail, send or share the pack.
  await expect(page.locator('a[href*="/files"], a[href^="mailto:"], a[href^="tel:"], a[download]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /download|send|share|export|copy|print|email/i })).toHaveCount(0);
  await expect(page.getByRole('link', { name: /download|send|share|export|copy|print|email/i })).toHaveCount(0);
  await expect(shortlist(page).getByRole('button')).toHaveCount(0);
  await expect(shortlist(page).getByRole('link')).toHaveCount(0);
  expect(await sentAndStored()).toEqual(before);
});

for (const theme of themes) {
  test(`AIV-P1-116 Scenario: Keyboard and contrast: Tab reaches "Back to the pack" with a visible focus, axe passes (${theme})`, async ({
    page,
    context,
    baseURL,
  }) => {
    await context.addCookies([{ name: 'theme', value: theme, url: baseURL ?? '' }]);
    await openPreview(page);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await expectAccessible(page);
    const back = page.getByRole('link', { name: 'Back to the pack' });
    await expect(async () => {
      await page.keyboard.press('Tab');
      await expect(back).toBeFocused({ timeout: 250 });
    }).toPass();
    expect(await css(back, 'outline-style')).toBe('solid');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL((url) => url.pathname === packPath);
    await expect(page.getByRole('link', { name: 'Preview as the hiring owner sees it' })).toBeVisible();
  });
}

// SAFETY: mutation check: the job layout returned its children instead of forbidden() for a job not granted -> this test failed (no 403 page)
test("AIV-P1-116 Scenario: Only the recruiter's jobs: a hiring owner granted another job is refused the preview", async ({
  page,
}) => {
  await signIn(page, { email: otherOwner });
  await page.goto(`${packPath}/preview`);
  await expect(page.getByText('You do not have access to this. Ask your workspace admin.')).toBeVisible();
  await expect(page.getByText('Round 2 shortlist')).toHaveCount(0);
  await expect(page.getByText('Sara Al Qahtani')).toHaveCount(0);
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
