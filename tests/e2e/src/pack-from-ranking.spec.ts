import { createAiClient, fakeProvider, memoryTokenBudget, type AiClient } from '@credalent/ai';
import { createAssessment, readAssessmentAsSystem } from '@credalent/assessment/composition';
import { createAudit } from '@credalent/audit/composition';
import { createCandidates, displayNamesInWorkspace, readPersonAsSystem } from '@credalent/candidates/composition';
import { withWorkspace } from '@credalent/db';
import { createDb } from '@credalent/db/client';
import { createConsumer } from '@credalent/db/consumer';
import { createPackSummaryHandlers, PACK_SUMMARY_QUEUE } from '@credalent/decisions/composition';
import { createEvidence, readEvidenceForJobAsSystem } from '@credalent/evidence/composition';
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
// refused it. AIV-P2-011 adds each member's card text, written by the worker's summary job, which this spec runs itself
// (no worker runs here) with the fake model: a cited answer for Sara, Huda and Daniel, and for Arjun one citing a
// source he was never given, so his card is "Summary unavailable"; and a member of another workspace, who gets 404.
// AIV-P1-149 adds what the selection must survive (a server refresh that started before the tick, a reload, the
// filters) and must not survive (a confirmed bulk action).
// Serial: the later tests open the pack the first one builds.
test.describe.configure({ mode: 'serial' });

let creator: string;
let interviewer: string;
let otherOwner: string;
let outsider: string;
let owner: string;
let workspaceId: string;
let workspaceName: string;
let jobId: string;
let packPath: string;
/** Sara's and Arjun's application ids, as the ranking's URL carried them (AIV-P1-149). */
let twoSelected: string;
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
  outsider = `omar+pack-${stamp}@example.com`;
  owner = `faisal+pack-${stamp}@example.com`;
  await approvedWorkspace(outsider, `Elsewhere ${stamp}`);
  workspaceName = `Pack ${stamp}`;
  const made = await approvedWorkspace(creator, workspaceName);
  workspaceId = made.workspaceId;
  const db = createDb(databaseUrl, { max: 1 });
  try {
    const interviewerId = await syntheticUser(db, interviewer);
    const otherOwnerId = await syntheticUser(db, otherOwner);
    const ownerId = await syntheticUser(db, owner);
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
      // AIV-P2-011: a hiring owner granted this job, who follows a card's source to the candidate's profile.
      await ctx.tx.execute(
        sql`insert into workspaces.member (workspace_id, user_id, role, status)
          values (${made.workspaceId}, ${ownerId}, 'hiring_owner', 'active')`,
      );
      await workspaces.grantJobAccess(ctx, { userId: ownerId, jobId: job.id });
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

// The answer the fake model gives for each member: every figure quoted, the strength citing the repository (S2), the
// risk the CV claim (S3), and the recommendation the facts (S1).
const ANSWER = {
  strengths: [
    {
      text: 'The candidate authored 301 of 340 commits in rag-service.',
      citations: [{ sourceId: 'S2', quote: 'authored 301 of 340 commits' }],
    },
  ],
  risks: [
    {
      text: 'Retrieval and evaluation rests on a claim with nothing to inspect.',
      citations: [{ sourceId: 'S3', quote: 'raised answer accuracy from 71% to 88%' }],
    },
  ],
  round1: null,
  recommendation: {
    action: 'advance',
    focus: 'Cost and reliability',
    citations: [{ sourceId: 'S1', quote: 'Work meets the need on competencies holding 55% of the weight' }],
  },
};

/** A fake model that gives `answer` to every request. */
const model = (answer: object) =>
  createAiClient({
    provider: fakeProvider({ completion: JSON.stringify(answer) }),
    budget: memoryTokenBudget(),
    sleep: async () => undefined,
  });

/**
 * Runs the worker's summary job (AIV-P2-011) on this workspace's pack events, as apps/backend/worker wires it, with the
 * fake model. The second member asked about (Arjun) gets an answer citing S9, a source he was never given.
 */
async function summarisePacks() {
  const db = createDb(databaseUrl, { max: 1 });
  try {
    const valid = model(ANSWER);
    const invalid = model({
      ...ANSWER,
      strengths: [{ ...ANSWER.strengths[0], citations: [{ sourceId: 'S9', quote: 'authored 301 of 340 commits' }] }],
    });
    let asked = 0;
    const ai: Pick<AiClient, 'generateStructured'> = {
      generateStructured: (request) => (asked++ === 1 ? invalid : valid).generateStructured(request),
    };
    const consumer = createConsumer({
      db,
      queue: PACK_SUMMARY_QUEUE,
      now: () => new Date(),
      handlers: createPackSummaryHandlers({
        ai,
        ...createApprovedRubricReads(),
        snapshot: readAssessmentAsSystem,
        evidence: readEvidenceForJobAsSystem,
        identifiersOf: async (tx, workspace, candidateId) => {
          const person = await readPersonAsSystem(tx, workspace, candidateId);
          return person && { names: [person.displayName], emails: person.emails, phones: person.phones };
        },
        scheduler: { schedule: async () => '1', cancel: async () => undefined },
      }),
    });
    const events = await withWorkspace(db, workspaceId, (tx) =>
      tx.execute<{ id: string; type: string; payload: unknown; occurred_at: Date }>(
        sql`select id, type, payload, occurred_at from decisions.outbox
          where type in ('PackReady.v1', 'PackMembersAdded.v1') order by occurred_at, id`,
      ),
    );
    for (const e of events) {
      const settled: string[] = [];
      await consumer.handle({
        body: {
          id: e.id,
          type: e.type,
          workspaceId,
          payload: e.payload,
          occurredAt: new Date(e.occurred_at).toISOString(),
          correlationId: null,
        },
        deliveryCount: 1,
        complete: async () => void settled.push('complete'),
        abandon: async () => void settled.push('abandon'),
        deadLetter: async (reason) => void settled.push(reason),
      });
      expect(settled).toEqual(['complete']);
    }
  } finally {
    await db.$client.end();
  }
}

async function openRanking(page: Page) {
  await signIn(page, { email: creator });
  await page.goto('/app/jobs');
  await page.getByRole('link', { name: 'Senior AI Engineer' }).click();
  // The ranking's first server render after sign-in took over 5 s on a CI runner with two workers (run 45877523565,
  // passed on retry); its title comes with that render.
  await expect(page).toHaveTitle('Senior AI Engineer: Evidence and ranking · Credalent', { timeout: 15_000 });
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

// SAFETY: mutation check: dropped clearSelection() from usePackController's onConfirm -> this test failed (3 rows stayed checked)
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
  // The rows say so once the server refresh after Confirm has arrived.
  for (const name of ['Sara Al Qahtani', 'Arjun Menon', 'Huda Al Mansoori'])
    await expect(row(page, name)).toContainText('In shortlist pack');
  // AIV-P1-149 Scenario: A confirmed bulk action clears the selection for good, the refresh included.
  await expect(table.getByRole('checkbox', { checked: true })).toHaveCount(0);
  await expect(bar(page)).toHaveCount(0);
  await expect(page).toHaveURL((url) => !url.searchParams.has('selected'));
  // Candidates outside the pack stay visible, unchanged: Daniel at 55, Maria not yet scored.
  for (const name of ['Daniel Novak', 'Maria Santos']) {
    await expect(row(page, name)).toBeVisible();
    await expect(row(page, name)).not.toContainText('In shortlist pack');
  }
  await expect(
    row(page, 'Daniel Novak').getByRole('img', { name: /^55 backed by evidence · up to \d+ if claims hold$/ }),
  ).toBeVisible();
  await expect(row(page, 'Maria Santos')).toContainText('Not yet scored');

  // Add to an existing pack: Daniel joins the undecided one, offered first. The new bulk action starts from him alone
  // ("Add 1"), never from the three just added (AGENTS.md 1.5).
  await tick(page, 'Daniel Novak');
  await expect(bar(page).getByRole('status')).toHaveText('1 selected');
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
    page.getByText(
      'Shared packs show evidence summaries and sources, not raw files. 1 other candidate stays in the ranking and can be added to a later pack.',
    ),
  ).toBeVisible();
  // AIV-P2-011 Scenario: Loading: until the worker has written them, each card says so, its score already shown.
  for (const name of ASSESSED) {
    const card = page.getByRole('region', { name });
    await expect(card.getByRole('status')).toHaveText('Preparing summary');
    await expect(card.getByRole('img', { name: /^55 backed by evidence · up to \d+ if claims hold$/ })).toBeVisible();
  }
  // The Decision stage is current on the pack's page, and its tab lists the pack.
  await expect(page.getByRole('link', { name: /^Decision/ })).toHaveAttribute('aria-current', 'page');
  // AIV-P2-011: the Decision stage reports the undecided pack.
  await expect(page.getByRole('link', { name: /^Decision/ })).toContainText('Shortlist ready');
  await page.getByRole('link', { name: /^Decision/ }).click();
  await page.getByRole('link', { name: 'Round 2 shortlist' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Round 2 shortlist: Senior AI Engineer' })).toBeVisible();
  await page.getByRole('link', { name: 'Back to ranking' }).click();
  await expect(page).toHaveTitle('Senior AI Engineer: Evidence and ranking · Credalent');
});

// SAFETY: mutation check: DecisionPack passed hrefFor={undefined} -> this test failed (no "Source: rag-service" link)
test("AIV-P2-011 Scenarios: the role and its weights, a card citing its evidence by keyboard, Credalent's recommendation, and a rejected answer not shown", async ({
  page,
}) => {
  await summarisePacks();
  await signIn(page, { email: creator });
  await page.goto(packPath);
  // The role and its weights, from the pack's rubric version.
  await expect(page.getByRole('heading', { name: 'What the job needs' })).toBeVisible();
  await expect(page.getByText('Ships reliable AI features.')).toBeVisible();
  await expect(
    page.getByText('Python service engineering 55% · Retrieval and evaluation 20% · Cost and reliability 25%'),
  ).toBeVisible();
  const sara = page.getByRole('region', { name: 'Sara Al Qahtani' });
  await expect(sara.getByRole('img', { name: /^55 backed by evidence · up to \d+ if claims hold$/ })).toBeVisible();
  await expect(sara.getByRole('list', { name: 'Strengths, backed' })).toContainText(
    'The candidate authored 301 of 340 commits in rag-service.',
  );
  await expect(sara.getByRole('list', { name: 'Outstanding risks' })).toContainText(
    'Retrieval and evaluation rests on a claim with nothing to inspect.',
  );
  await expect(sara.getByText('Round 1 finding').locator('xpath=following-sibling::*[1]')).toHaveText(
    'None stated in this summary.',
  );
  // Her CV's words are a claim: labelled so, never highlighted as cited evidence (AGENTS.md 1.6).
  const claim = sara
    .getByRole('list', { name: 'Outstanding risks' })
    .getByText('raised answer accuracy from 71% to 88%');
  await expect(claim).toBeVisible();
  await expect(sara.locator('mark').filter({ hasText: 'raised answer accuracy' })).toHaveCount(0);
  await expect(sara.getByRole('list', { name: 'Outstanding risks' })).toContainText('Claim awaiting validation');
  await expect(sara.getByText("Credalent's recommendation:")).toHaveText(
    "Credalent's recommendation: advance, and look into Cost and reliability next",
  );
  // No decision is chosen: the recommendation decides nothing, and the choices are the hiring owner's (AIV-P2-012).
  await expect(page.locator('[aria-pressed="true"], [aria-checked="true"], input:checked')).toHaveCount(0);
  // The answer citing a source outside Arjun's snapshot is not shown: the assessment's own strengths are.
  const arjun = page.getByRole('region', { name: 'Arjun Menon' });
  await expect(arjun.getByText('Summary unavailable')).toBeVisible();
  await expect(arjun.getByRole('list', { name: 'Strengths, backed' }).getByRole('listitem')).toHaveText([
    /^Python service engineering/,
  ]);
  await expect(arjun.getByText("Credalent's recommendation:")).toHaveCount(0);
  // Each sentence links to the evidence item it rests on: by keyboard, to the item on Sara's profile.
  const source = sara.getByRole('link', { name: 'Source: rag-service' });
  await expect(async () => {
    await page.keyboard.press('Tab');
    await expect(source).toBeFocused({ timeout: 250 });
  }).toPass();
  expect(await css(source, 'outline-style')).toBe('solid');
  await page.keyboard.press('Enter');
  // The profile's first render through a client-side navigation: `next dev` compiled it for over 5 s on a CI runner
  // (runs 45884971232 and 45887025808), and the URL changes only when that render arrives. Its heading comes with it.
  await expect(page.getByRole('heading', { level: 1, name: 'Sara Al Qahtani' })).toBeVisible({ timeout: 15_000 });
  await expect(page).toHaveURL(
    (url) => url.pathname.startsWith('/app/candidates/') && url.hash.startsWith('#evidence-'),
  );
});

// AGENTS.md 1.9: a card's source opens the candidate's profile; a hiring owner there sees summaries and sources only.
// This app has no storage account, so nobody gets a file link here: that a hiring owner never gets one while a recruiter
// does is proven in loadProfile.test.ts (a file-backed item; `seesFiles` forced true -> that test failed). Here: Sara's
// stored email and phone never show.
test('AIV-P2-011: a hiring owner following a source reaches the evidence, never a raw file or contact detail', async ({
  page,
}) => {
  await signIn(page, { email: owner });
  await page.goto(packPath);
  await page
    .getByRole('region', { name: 'Sara Al Qahtani' })
    .getByRole('link', { name: 'Source: rag-service' })
    .click();
  await expect(page).toHaveURL(
    (url) => url.pathname.startsWith('/app/candidates/') && url.hash.startsWith('#evidence-'),
  );
  await expect(page.getByRole('heading', { level: 1, name: 'Sara Al Qahtani' })).toBeVisible();
  await expect(page.locator('mark').filter({ hasText: 'authored 301 of 340 commits' }).first()).toBeVisible();
  const text = await page.locator('body').innerText();
  expect(text).not.toContain(SARA_EMAIL);
  expect(text.replace(/\D/g, '')).not.toContain(SARA_PHONE.slice(1));
  await expect(page.locator('a[href*="/files"], a[href^="mailto:"], a[href^="tel:"], a[download]')).toHaveCount(0);
});

test('AIV-P2-011 Scenario: Access: a member of another workspace who opens the pack URL gets 404', async ({ page }) => {
  await signIn(page, { email: outsider });
  expect((await page.goto(packPath))?.status()).toBe(404);
  await expect(page.getByText('Sara Al Qahtani')).toHaveCount(0);
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

test('AIV-P1-116 Scenario: Open the preview, by keyboard: each person, score and basis, and the cited strengths, risks and recommendation', async ({
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
    // AIV-P2-011: the pack's own cited text, stored when the member joined; Arjun's was rejected, so his levels show.
    if (name === 'Arjun Menon') {
      await expect(card.getByText('Summary unavailable')).toBeVisible();
      await expect(card.getByRole('list', { name: 'Backed by evidence' }).getByRole('listitem')).toHaveText([
        /^Python service engineering/,
      ]);
      await expect(card.getByRole('list', { name: 'Still to test in the interview' }).getByRole('listitem')).toHaveText(
        [/^Cost and reliability.*3 short$/, /^Retrieval and evaluation.*3 short, claimed$/],
      );
      continue;
    }
    await expect(card.getByRole('list', { name: 'Backed by evidence' })).toContainText(
      'The candidate authored 301 of 340 commits in rag-service.',
    );
    await expect(card.getByRole('list', { name: 'Still to test in the interview' })).toContainText(
      'Retrieval and evaluation rests on a claim with nothing to inspect.',
    );
    await expect(card.locator('mark').filter({ hasText: 'authored 301 of 340 commits' })).toBeVisible();
    await expect(card.getByText('Source: rag-service')).toBeVisible();
    await expect(card.getByText("Credalent's recommendation:")).toHaveText(
      "Credalent's recommendation: advance, and look into Cost and reliability next",
    );
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
    // Cancel keeps the selection (AIV-P1-149).
    await expect(row(page, 'Maria Santos').getByRole('checkbox')).toBeChecked();
    await expect(bar(page).getByRole('status')).toHaveText('1 selected');
  });
}

/** Sets the job's title in the database: a change the ranking shows only once a server refresh has arrived. */
async function retitle(title: string) {
  const db = createDb(databaseUrl, { max: 1 });
  try {
    await withWorkspace(db, workspaceId, async (tx) => {
      // The job table's second policy: a member's job scope, here every job as for an admin.
      await tx.execute(sql`select set_config('app.job_scope', 'all', true)`);
      await tx.execute(sql`update jobs.job set title = ${title} where id = ${jobId}`);
    });
  } finally {
    await db.$client.end();
  }
}

for (const theme of themes) {
  // SAFETY: mutation check: useRankingController read the selection from useSearchParams() on every render, as before
  // AIV-P1-149 -> this test failed (Sara's box stayed unticked while the refresh was held: Next's useSearchParams does
  // not follow the URL until the refresh lands, so a second tick started from the stale selection and lost the first)
  test(`AIV-P1-149 Scenario: A server refresh in flight does not wipe a tick (${theme})`, async ({
    page,
    context,
    baseURL,
  }) => {
    await context.addCookies([{ name: 'theme', value: theme, url: baseURL ?? '' }]);
    const table = await openRanking(page);
    // Hydrated: a tick and its undo both took. From here one key press is one tick, with no retry to hide a lost one.
    // click(), not uncheck(): the mutation check must reach the held refresh, and uncheck() fails the old code here.
    await tick(page, 'Maria Santos');
    await table.getByRole('checkbox', { name: 'Select Maria Santos' }).click();
    await expect(bar(page)).toHaveCount(0);

    const held = Promise.withResolvers<void>();
    const released = Promise.withResolvers<void>();
    // The refresh's response (React Server Components payload), fetched from the server and then held back.
    await page.route(
      (url) => url.pathname === `/app/jobs/${jobId}/candidates`,
      async (route) => {
        const headers = route.request().headers();
        if (headers['rsc'] !== '1' || headers['next-router-prefetch']) return route.fallback();
        const response = await route.fetch();
        held.resolve();
        await released.promise;
        await route.fulfill({ response });
      },
    );
    await retitle('Senior AI Engineer, refreshed');
    try {
      // The router Next exposes on the page: the same refresh a confirmed bulk action or a merge starts.
      await page.evaluate(() => (window as unknown as { next: { router: { refresh(): void } } }).next.router.refresh());
      await held.promise;
      await table.getByRole('checkbox', { name: 'Select all 5 shown' }).focus();
      const sara = table.getByRole('checkbox', { name: 'Select Sara Al Qahtani' });
      await expect(async () => {
        await page.keyboard.press('Tab');
        await expect(sara).toBeFocused({ timeout: 250 });
      }).toPass();
      await page.keyboard.press('Space');
      await expect(sara).toBeChecked();
      released.resolve();
      // The refresh has arrived: the page shows the title it was rendered with.
      await expect(page).toHaveTitle('Senior AI Engineer, refreshed: Evidence and ranking · Credalent');
      await expect(sara).toBeChecked();
      await expect(table.getByRole('checkbox', { checked: true })).toHaveCount(1);
      await expect(bar(page).getByRole('status')).toHaveText('1 selected');
      await expect(bar(page).getByRole('button', { name: 'Add to decision pack' })).toBeVisible();
      // One opaque application id and nothing else: no name, email or score (AGENTS.md 1.2).
      await expect(page).toHaveURL((url) => /^\?selected=[0-9a-f-]{36}$/.test(url.search));
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await expectAccessible(page);
    } finally {
      released.resolve();
      await retitle('Senior AI Engineer');
    }
  });
}

test('AIV-P1-149 Scenario: The selection still survives a reload and the filters; an id not on this ranking is ignored', async ({
  page,
}) => {
  const table = await openRanking(page);
  await tick(page, 'Sara Al Qahtani');
  await tick(page, 'Arjun Menon');
  await expect(page).toHaveURL((url) => /^\?selected=[0-9a-f-]{36}(%2C|,)[0-9a-f-]{36}$/.test(url.search));
  twoSelected = new URL(page.url()).searchParams.get('selected') ?? '';
  await page.reload();
  for (const name of ['Sara Al Qahtani', 'Arjun Menon'])
    await expect(table.getByRole('checkbox', { name: `Select ${name}` })).toBeChecked();
  await expect(bar(page).getByRole('status')).toHaveText('2 selected');
  // The ticked boxes come with the server's HTML, so they do not show the page has hydrated: typing before it is lost.
  await expect(async () => {
    await page.getByRole('searchbox', { name: 'Search candidates' }).fill('menon');
    await expect(table.getByRole('checkbox', { name: /^Select [A-Z]/ })).toHaveCount(1, { timeout: 1000 });
  }).toPass();
  await expect(bar(page).getByRole('status')).toHaveText('2 selected · 1 not shown in the table');

  // An id that is no row of this ranking is dropped, from the selection and from the URL.
  await page.goto(`/app/jobs/${jobId}/candidates?selected=${twoSelected},${crypto.randomUUID()}`);
  await expect(bar(page).getByRole('status')).toHaveText('2 selected');
  await expect(page).toHaveURL((url) => url.searchParams.get('selected') === twoSelected);
});

// The server gives an interviewer no bulk action (AGENTS.md 1.3), so the page offers no selection to restore.
test('AIV-P1-149 Scenario: A member with no bulk action gets no selection, whatever the URL says', async ({ page }) => {
  // Two valid ids, from the test before this one.
  expect(twoSelected).toMatch(/^[0-9a-f-]{36},[0-9a-f-]{36}$/);
  await signIn(page, { email: interviewer });
  await page.goto(`/app/jobs/${jobId}/candidates?selected=${twoSelected}`);
  const table = page.getByRole('table', { name: 'Ranked candidates' });
  await expect(table.getByRole('row').filter({ hasText: 'Sara Al Qahtani' })).toBeVisible();
  await expect(table.getByRole('checkbox')).toHaveCount(0);
  await expect(bar(page)).toHaveCount(0);
});
