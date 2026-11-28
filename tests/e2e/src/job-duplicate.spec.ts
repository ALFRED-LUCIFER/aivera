import { createAudit } from '@credalent/audit/composition';
import { createDb } from '@credalent/db/client';
import type { Competency, JobsContract } from '@credalent/jobs';
import { createJobs } from '@credalent/jobs/composition';
import type { WorkspaceContext } from '@credalent/workspaces';
import { createWorkspaces } from '@credalent/workspaces/composition';
import { databaseUrl } from '../playwright.config.ts';
import { signIn } from './auth.ts';
import { expect, test } from './csp.ts';
import { expectAccessible, themes } from './gallery.ts';
import { approvedWorkspace } from './workspaces.ts';

// AIV-P1-165 (#677 section 2) "An agency can start from an earlier job or rubric": an agency of its own (so no other
// spec's job counts move) with clients Dune Logistics and Falcon Pay and an approved "Staff Backend Engineer" job for
// Dune Logistics. That only competencies are read, for the caller's own workspace and role, is the unit test
// apps/web/src/features/job-new/services/duplicateRubric.test.ts; workspace isolation of the read is
// tests/integration job-pages.test.ts.

const SOURCE = 'Staff Backend Engineer · Dune Logistics';
const competency = (
  name: string,
  weightPercent: number,
  levelNeeded: number,
  type: Competency['type'],
): Competency => ({
  name,
  evidenceExpected: `Evidence of ${name.toLowerCase()}`,
  weightPercent,
  levelNeeded,
  type,
  origin: 'from_description',
});
const RUBRIC = [
  competency('API design', 50, 4, 'mandatory'),
  competency('Ledger correctness', 30, 5, 'mandatory'),
  competency('Mentoring engineers', 20, 2, 'desirable'),
];

let creator: string;
let workspaceId: string;
let creatorUserId: string;

/** Reads through the jobs contract as the creator, in her workspace. */
const withJobs = async <T>(work: (jobs: JobsContract, ctx: WorkspaceContext) => Promise<T>) => {
  const db = createDb(databaseUrl, { max: 1 });
  try {
    const audit = createAudit(db);
    const workspaces = createWorkspaces(db, audit);
    return await workspaces.withWorkspace({ userId: creatorUserId }, workspaceId, (ctx) =>
      work(createJobs(workspaces, audit), ctx),
    );
  } finally {
    await db.$client.end();
  }
};

test.beforeAll(async () => {
  const stamp = Date.now();
  creator = `omar.agency+duplicate-${stamp}@example.com`;
  ({ workspaceId, creatorUserId } = await approvedWorkspace(creator, `Gulf Talent ${stamp}`));
  const db = createDb(databaseUrl, { max: 1 });
  try {
    const audit = createAudit(db);
    const workspaces = createWorkspaces(db, audit);
    const jobs = createJobs(workspaces, audit);
    await workspaces.withWorkspace({ userId: creatorUserId }, workspaceId, async (ctx) => {
      await workspaces.setWorkspaceType(ctx, 'agency');
      const dune = await workspaces.addClient(ctx, 'Dune Logistics');
      await workspaces.addClient(ctx, 'Falcon Pay');
      const job = await jobs.createJob(ctx, {
        title: 'Staff Backend Engineer',
        jobType: 'software_engineering',
        description: 'Staff Backend Engineer, synthetic e2e job to duplicate.',
        clientId: dune.id,
        synthetic: true,
      });
      const saved = await jobs.saveRubric(ctx, job.id, { successStatement: 'Ships the ledger.', competencies: RUBRIC });
      await jobs.approveRubric(ctx, saved.id, saved.revision);
    });
  } finally {
    await db.$client.end();
  }
});

for (const theme of themes) {
  test(`Scenario: An agency can start from an earlier job or rubric, from the keyboard (${theme})`, async ({
    page,
    context,
    baseURL,
  }) => {
    await context.addCookies([{ name: 'theme', value: theme, url: baseURL ?? '' }]);
    const title = `Staff Backend Engineer ${theme} ${Date.now()}`;
    await signIn(page, { email: creator });
    await page.goto('/app/jobs/new');
    await page.getByLabel('Job title').pressSequentially(title);
    // The job type follows the title (AIV-P1-165).
    await expect(page.getByLabel('Job type')).toHaveValue('software_engineering');
    await page.getByLabel('Team or client').selectOption({ label: 'Falcon Pay' });

    const source = page.getByLabel('Duplicate an earlier job or rubric');
    await source.focus();
    await source.selectOption({ label: SOURCE });
    await expectAccessible(page);
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Copy its competencies' })).toBeFocused();
    await page.keyboard.press('Enter');

    await expect(
      page.getByText(`Competencies copied from ${SOURCE}. No candidate, note or decision was copied.`),
    ).toBeVisible();
    const rows = page.getByRole('table', { name: 'Drafted competencies' }).getByRole('row');
    for (const [i, c] of RUBRIC.entries()) {
      const cells = rows.nth(i + 1).getByRole('cell');
      await expect(cells.nth(0)).toContainText(c.name);
      await expect(cells.nth(1)).toHaveText(`${c.weightPercent}%`);
      await expect(cells.nth(2)).toHaveText(`${c.levelNeeded} of 5`);
      await expect(cells.nth(3)).toHaveText(c.type === 'mandatory' ? 'Mandatory' : 'Desirable');
    }
    await expect(rows).toHaveCount(RUBRIC.length + 1);
    await expect(page.getByText('Weights total 100%')).toBeVisible();
    // A draft she edits like any other, and nothing to replace: the copy is offered only before there are rows.
    await expect(source).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Remove API design' })).toBeVisible();
    await expectAccessible(page);

    const save = page.getByRole('button', { name: 'Save job and rubric' });
    await save.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByText(/Job saved/).first()).toBeVisible();

    // The new job is Falcon Pay's, with its own rubric version 1 as a draft holding the copied competencies.
    const saved = await withJobs(async (jobs, ctx) => {
      const job = (await jobs.listJobs(ctx)).find((j) => j.title === title);
      const versions = job && (await jobs.listRubricVersions(ctx, job.id));
      return versions?.map((v) => ({
        status: v.status,
        version: v.version,
        changeNote: v.changeNote,
        competencies: v.competencies.map((c) => [c.name, c.weightPercent, c.levelNeeded, c.type, c.origin]),
      }));
    });
    expect(saved).toEqual([
      {
        status: 'draft',
        version: 1,
        changeNote: null,
        competencies: RUBRIC.map((c) => [c.name, c.weightPercent, c.levelNeeded, c.type, 'added_by_recruiter']),
      },
    ]);
  });
}
