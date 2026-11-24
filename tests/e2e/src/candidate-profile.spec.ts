import { createAudit } from '@credalent/audit/composition';
import { createCandidates, displayNamesInWorkspace } from '@credalent/candidates/composition';
import { createDb } from '@credalent/db/client';
import { createIntake } from '@credalent/intake/composition';
import { createJobs } from '@credalent/jobs/composition';
import { createWorkspaces } from '@credalent/workspaces/composition';
import type { Page } from '@playwright/test';
import { receiveConfirmed } from '../confirmedBatch.ts';
import { databaseUrl } from '../playwright.config.ts';
import { signIn } from './auth.ts';
import { expect, test } from './csp.ts';
import { expectAccessible, themes } from './gallery.ts';
import { approvedWorkspace } from './workspaces.ts';

// AIV-P1-043, a step of J2: the top of the candidate evidence profile. AP's workspace "Demo" (seed.ts) ranks Sara Al
// Qahtani first of eight on Senior AI Engineer, 68 up to 84, with two competencies resting on claims; the harness has no
// model answer for the explanation, so it is the template, marked "Summary generated without AI". A second workspace of
// this spec's own holds a Sara who applied to a job with no approved rubric, so no seeded count changes.
const AP = 'ap@example.com';
const FIT =
  "68 backed by evidence · up to 84 if their two open claims hold · meets the job's need on 4 of 6 competencies · rank 1 of 8";

let creator: string;
let unassessed: string; // the profile's path in this spec's own workspace
let elsewhere: string; // that workspace's Sara: a candidate id AP's workspace does not have

test.beforeAll(async () => {
  const stamp = Date.now();
  creator = `alex+profile-${stamp}@example.com`;
  const { workspaceId, creatorUserId } = await approvedWorkspace(creator, `Profile ${stamp}`);
  const db = createDb(databaseUrl, { max: 1 });
  try {
    const audit = createAudit(db);
    const workspaces = createWorkspaces(db, audit);
    const jobs = createJobs(workspaces, audit);
    const intake = createIntake(workspaces, createCandidates(workspaces), jobs, displayNamesInWorkspace, audit);
    await workspaces.withWorkspace({ userId: creatorUserId }, workspaceId, async (ctx) => {
      // A draft rubric only: nothing is assessed before a rubric is approved.
      const job = await jobs.createJob(ctx, {
        title: 'Staff Backend Engineer',
        jobType: 'ai_llm_engineering',
        description: 'Staff Backend Engineer, synthetic e2e job.',
        synthetic: true,
      });
      const { personId } = await receiveConfirmed(intake, ctx, {
        jobId: job.id,
        person: {
          displayName: 'Sara Al Qahtani',
          identifiers: [{ type: 'cv_hash', value: '1'.padStart(64, '0') }],
          synthetic: true,
        },
        source: 'linkedin',
        fileIds: [crypto.randomUUID()],
      });
      elsewhere = personId;
      unassessed = `/app/candidates/${personId}?job=${job.id}`;
    });
  } finally {
    await db.$client.end();
  }
});

/** Opens Senior AI Engineer's ranking from the Jobs list. */
async function openRanking(page: Page) {
  await page.goto('/app/jobs');
  await page.getByRole('link', { name: 'Senior AI Engineer' }).click();
  await expect(page).toHaveTitle('Senior AI Engineer: Evidence and ranking · Credalent');
}

/** Opens Sara's profile from the ranking by keyboard and returns its path with the query. */
async function openSara(page: Page) {
  await openRanking(page);
  await page.getByRole('table', { name: 'Ranked candidates' }).getByRole('link', { name: 'Sara Al Qahtani' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 1, name: 'Sara Al Qahtani' })).toBeVisible();
  const url = new URL(page.url());
  return url.pathname + url.search;
}

for (const theme of themes) {
  test(`Scenario: Sara's fit: opened from the ranking by keyboard, axe passes (${theme})`, async ({
    page,
    context,
    baseURL,
  }) => {
    await context.addCookies([{ name: 'theme', value: theme, url: baseURL ?? '' }]);
    await signIn(page, { email: AP });
    // The address carries opaque ids only (AGENTS.md 1.2), and the title names the page, not the person.
    expect(await openSara(page)).toMatch(/^\/app\/candidates\/[0-9a-f-]{36}\?job=[0-9a-f-]{36}$/);
    await expect(page).toHaveTitle('Candidate profile · Credalent');
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toHaveText(
      'Candidates/Sara Al Qahtani·Back to the Senior AI Engineer ranking',
    );
    await expect(page.getByText('Senior AI Engineer · New', { exact: true })).toBeVisible();

    await expect(page.getByRole('heading', { level: 2, name: 'Fit for Senior AI Engineer' })).toBeVisible();
    await expect(page.getByText('68', { exact: true })).toBeVisible();
    await expect(page.getByText(FIT, { exact: true })).toBeVisible();
    // The bar's text equivalent is the same line.
    await expect(page.getByRole('img', { name: FIT })).toBeVisible();
    await expect(page.getByText('Backed scores and needs met are observed from inspected evidence.')).toBeVisible();

    // "Why they are ranked here" (AIV-P1-033): numbers from the snapshot, the cited words highlighted with their source.
    await expect(page.getByRole('heading', { level: 3, name: 'Why they are ranked here' })).toBeVisible();
    await expect(page.getByRole('listitem').filter({ hasText: 'of the weight' })).toHaveText([
      'Two competencies carrying 45% of the weight are backed by work that was independently checked.',
      'Two competencies carrying 25% of the weight still rest on claims: Arabic and bilingual NLP, and Product judgement.',
    ]);
    const cited = page.getByRole('listitem').filter({ hasText: 'The cited work behind LLM systems in production' });
    await expect(cited.locator('mark')).toHaveText('cited evidence authored 412 of 460 commits');
    await expect(cited).toContainText('Source: llm-eval-harness');
    await expect(page.getByText('Summary generated without AI')).toBeVisible();
    // Later tickets' actions are not shipped as dead buttons.
    await expect(page.getByRole('button', { name: /Compare|Request evidence|Open decision pack/ })).toHaveCount(0);
    await expectAccessible(page);

    // Keyboard path back: the breadcrumb's link returns to the ranking.
    await page.getByRole('link', { name: 'Back to the Senior AI Engineer ranking' }).focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveTitle('Senior AI Engineer: Evidence and ranking · Credalent');
  });

  test(`Scenario: Candidate not assessed for this job: no approved rubric, axe passes (${theme})`, async ({
    page,
    context,
    baseURL,
  }) => {
    await context.addCookies([{ name: 'theme', value: theme, url: baseURL ?? '' }]);
    await signIn(page, { email: creator });
    await page.goto(unassessed);
    await expect(page.getByRole('heading', { level: 1, name: 'Sara Al Qahtani' })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await expect(page.getByText('Staff Backend Engineer · New', { exact: true })).toBeVisible();
    await expect(page.getByText('Jobs without an approved rubric are not assessed.')).toBeVisible();
    // No score and no explanation are shown for a job that assesses nobody yet.
    await expect(page.getByText(/backed by evidence/)).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Why they are ranked here' })).toHaveCount(0);
    await expectAccessible(page);
  });
}

test('Scenario: Another workspace: a candidate id or a job from another workspace is the not-found page', async ({
  page,
  context,
}) => {
  await signIn(page, { email: AP });
  const sara = await openSara(page);
  const job = new URL(page.url()).searchParams.get('job') ?? '';
  // Another workspace's candidate on AP's own job, an id nobody has, and no job at all: one answer.
  for (const path of [
    `/app/candidates/${elsewhere}?job=${job}`,
    `/app/candidates/${crypto.randomUUID()}?job=${job}`,
    sara.replace(/\?.*$/, ''),
  ]) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1, name: 'We could not find that page.' })).toBeVisible();
    await expect(page.getByText('Sara Al Qahtani')).toHaveCount(0);
  }
  // The creator of this spec's workspace opens AP's Sara by her address: their workspace has neither her nor the job.
  await context.clearCookies({ name: '__Host-credalent-session' });
  await signIn(page, { email: creator });
  await page.goto(sara);
  await expect(page.getByRole('heading', { level: 1, name: 'We could not find that page.' })).toBeVisible();
  await expect(page.getByText('Sara Al Qahtani')).toHaveCount(0);
});

test('a hiring owner not granted the job gets the 403 page, not the profile', async ({ page, context }) => {
  await signIn(page, { email: AP });
  const sara = await openSara(page);
  await context.clearCookies({ name: '__Host-credalent-session' });
  // Hana is a hiring owner in "Demo" with no grant on Senior AI Engineer (seed.ts).
  await signIn(page, { email: 'hana.owner@example.com' });
  await page.goto(sara);
  await expect(page.getByText('You do not have access to this. Ask your workspace admin.')).toBeVisible();
  await expect(page.getByText('Sara Al Qahtani')).toHaveCount(0);
});
