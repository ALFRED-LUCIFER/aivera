import { createDb } from '@credalent/db/client';
import { expect, test, type Page } from '@playwright/test';
import { sql } from 'drizzle-orm';
import { databaseUrl } from '../playwright.config.ts';
import { signIn } from './auth.ts';
import { expectAccessible, themes } from './gallery.ts';

// AIV-P5-015 (ADR-012): the catalogue at /ops/catalogue. AIV-P2-045 (ADR-013): with no draft it is read-only with
// "Start a draft"; with one, operators add, edit and retire packs and competencies. playwright.config.ts makes Pia
// Platform an operator. Synthetic people and catalogue text only (docs/00-product/personas.md).
//
// One draft at a time across the whole database, so this file runs in order and starts with none: the draft of an
// earlier run is discarded here (the discard screen is AIV-P2-049).
test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  const db = createDb(databaseUrl, { max: 1 });
  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`delete from jobs.catalogue_eval_run where version in
        (select version from jobs.catalogue_version where status = 'draft')`);
      for (const table of ['regional_hint', 'pack_competency', 'pack', 'region', 'job_type'])
        await tx.execute(
          sql`delete from ${sql.identifier('jobs')}.${sql.identifier(`catalogue_${table}`)} where version in
            (select version from jobs.catalogue_version where status = 'draft')`,
        );
      await tx.execute(sql`delete from jobs.catalogue_version where status = 'draft'`);
    });
  } finally {
    await db.$client.end();
  }
});

const PIA = 'pia.platform@example.com';
const PACKS = [
  'Payments and fintech',
  'Banking and Islamic finance',
  'Healthcare',
  'E-commerce and marketplaces',
  'Logistics and mobility',
  'Government and public sector',
  'Telecom',
  'Energy and utilities',
];
const LEDGER = 'Ledger and double-entry accounting';

const packSummary = (page: Page, name: string) => page.locator('main summary').filter({ hasText: name }).first();
const pack = (page: Page, name: string) =>
  page
    .locator('main details')
    .filter({ has: page.locator('summary').filter({ hasText: name }) })
    .first();
const competency = (page: Page, name: string) =>
  page.locator('main details li').filter({ has: page.getByRole('heading', { level: 3, name, exact: true }) });

async function openCatalogue(page: Page) {
  await signIn(page, { email: PIA });
  const response = await page.goto('/ops/catalogue');
  expect(response?.status()).toBe(200);
  await expect(page.getByRole('heading', { level: 1, name: 'Catalogue' })).toBeVisible();
}

async function openPaymentsForSoftwareEngineering(page: Page) {
  await packSummary(page, 'Payments and fintech').click();
  await pack(page, 'Payments and fintech').locator('summary').filter({ hasText: 'Software engineering' }).click();
}

test.describe('no draft: the published version', () => {
  test('Scenario: Job types and packs are listed with versions', async ({ page }) => {
    await openCatalogue(page);
    await expect(page).toHaveTitle('Catalogue');
    await expect(
      page.getByRole('navigation', { name: 'Operations' }).getByRole('link', { name: 'Catalogue' }),
    ).toBeVisible();
    const jobTypes = page.getByRole('table');
    await expect(page.getByRole('heading', { level: 2, name: 'Job types · version 1' })).toBeVisible();
    await expect(jobTypes.getByRole('rowheader')).toHaveCount(10);
    await expect(jobTypes.getByRole('row').filter({ hasText: 'Software engineering' })).toContainText(
      'Repositories, shipped products, code reviews',
    );
    await expect(page.getByRole('heading', { level: 2, name: 'Domain packs · version 1' })).toBeVisible();
    const summaries = page.locator('main > * details:not(details details) > summary');
    await expect(summaries).toHaveCount(8);
    for (const [i, name] of PACKS.entries()) {
      await expect(summaries.nth(i)).toContainText(name);
      await expect(summaries.nth(i)).toContainText(/Version 1 · \d+ job types?/);
    }
  });

  test('Scenario: A pack shows its competencies per job type', async ({ page }) => {
    await openCatalogue(page);
    const payments = pack(page, 'Payments and fintech');
    await openPaymentsForSoftwareEngineering(page);
    const swe = payments.locator('details').filter({ hasText: 'Software engineering' }).first();
    const entry = swe.getByRole('listitem').filter({
      has: page.getByRole('heading', { name: 'Idempotent payment APIs and retries' }),
    });
    await expect(swe.getByRole('heading', { level: 3, name: 'Default suggestions' })).toBeVisible();
    await expect(entry).toContainText('Code with idempotency keys and retry tests');
    await expect(entry).toContainText('Level 1Has called a payment API and handled declines');
    await expect(entry).toContainText('Desirable');
    await expect(entry).toContainText('Level 3 needed');
    for (const region of ['Regional hints for the UAE', 'Regional hints for KSA', 'Regional hints for India']) {
      const group = swe.locator('section').filter({ has: page.getByRole('heading', { level: 3, name: region }) });
      await expect(group.getByRole('listitem').first()).toContainText('Evidence that counts');
    }
  });

  test('Scenario Outline: Page states: no draft exists', async ({ page }) => {
    await openCatalogue(page);
    await expect(page.getByText('Recruiters see version 1. Start a draft to change it.')).toBeVisible();
    // Nothing here edits the published version: the one control is "Start a draft".
    await openPaymentsForSoftwareEngineering(page);
    await expect(page.locator('main').locator('button, input, textarea, select, form, [contenteditable]')).toHaveCount(
      1,
    );
    await expect(page.getByRole('button', { name: 'Start a draft' })).toBeVisible();
  });

  // SAFETY: mutation check: removed `await platformOperator()` from the /ops layout and the catalogue page -> this test failed (200)
  test('Scenario: Non-operators are refused', async ({ page }) => {
    await signIn(page, { email: 'alex@example.com' });
    const response = await page.goto('/ops/catalogue');
    expect(response?.status()).toBe(403);
    await expect(page.getByText('You do not have access to this. Ask your workspace admin.')).toBeVisible();
    expect(await response?.text()).not.toMatch(/Payments and fintech|Job types · version|Start a draft/);
  });

  test('the keyboard path: from "Start a draft" into a pack and a job type', async ({ page }) => {
    await openCatalogue(page);
    await page.getByRole('button', { name: 'Start a draft' }).focus();
    await page.keyboard.press('Tab');
    await expect(packSummary(page, 'Payments and fintech')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(pack(page, 'Payments and fintech')).toHaveAttribute('open', '');
    await page.keyboard.press('Tab');
    const swe = pack(page, 'Payments and fintech').locator('summary').filter({ hasText: 'Software engineering' });
    await expect(swe).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'Idempotent payment APIs and retries' })).toBeVisible();
  });

  for (const theme of themes) {
    test(`axe passes on the catalogue with a pack open (${theme})`, async ({ page, context, baseURL }) => {
      await context.addCookies([{ name: 'theme', value: theme, url: baseURL ?? '' }]);
      await openCatalogue(page);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await openPaymentsForSoftwareEngineering(page);
      await expect(page.getByRole('heading', { name: 'Idempotent payment APIs and retries' })).toBeVisible();
      await expectAccessible(page);
    });
  }
});

test.describe('the draft', () => {
  test('Scenario: Starting a draft copies the published version', async ({ page }) => {
    await openCatalogue(page);
    await page.getByRole('button', { name: 'Start a draft' }).click();
    await expect(page.getByText('Draft — not live. Recruiters see version 1.')).toBeVisible();
    const summaries = page.locator('main details > summary');
    await expect(summaries).toHaveCount(8);
    for (const [i, name] of PACKS.entries()) {
      await expect(summaries.nth(i)).toContainText(name);
      await expect(summaries.nth(i)).toContainText('Live');
    }
    await page.goto('/ops/audit');
    await expect(page.getByRole('row').filter({ hasText: 'Catalogue draft opened' }).first()).toContainText(
      'pia.platform',
    );
  });

  test('Scenario: Adding a pack and a competency, by keyboard', async ({ page }) => {
    await openCatalogue(page);
    await page.getByRole('button', { name: 'Add a pack' }).focus();
    await page.keyboard.press('Enter');
    const packDialog = page.getByRole('dialog', { name: 'Add a pack' });
    await expect(packDialog.getByLabel('Key')).toBeFocused();
    await page.keyboard.type('insurance');
    await page.keyboard.press('Tab');
    await page.keyboard.type('Insurance and insurtech');
    await page.keyboard.press('Enter');
    await expect(packDialog).toBeHidden();
    const insurance = packSummary(page, 'Insurance and insurtech');
    await expect(insurance).toContainText('New in draft');

    await insurance.click();
    await page.getByRole('button', { name: 'Add a competency to Insurance and insurtech' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add a competency' });
    await dialog.getByLabel('Name').fill('Claims processing systems');
    await dialog.getByLabel('What it means').fill('Builds and runs the systems that take a claim to payment.');
    await dialog
      .getByLabel('Evidence that counts')
      .fill('Claims workflow code and tests; incident reviews of claim errors');
    for (const level of [1, 3, 5])
      await dialog.getByRole('textbox', { name: `Level ${level}` }).fill(`Claims work at level ${level}`);
    await dialog.getByRole('group', { name: 'Default suggestion for' }).getByLabel('Software engineering').check();
    await expect(
      dialog.getByRole('group', { name: 'Applies to job types' }).getByLabel('Software engineering'),
    ).toBeChecked();
    await expect(dialog.getByRole('radio', { name: 'Level 3' })).toBeChecked();
    await expect(dialog).toContainText('Desirable');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog).toBeHidden();
    await expect(competency(page, 'Claims processing systems')).toContainText('New in draft');
    await expect(competency(page, 'Claims processing systems')).toContainText(
      'Default suggestion for Software engineering',
    );
  });

  test('Scenario Outline: Fairness is enforced on save', async ({ page }) => {
    await openCatalogue(page);
    await packSummary(page, 'Insurance and insurtech').click();
    await page.getByRole('button', { name: 'Add a competency to Insurance and insurtech' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add a competency' });
    await dialog.getByLabel('Name').fill('Worked at a top insurer');
    await dialog.getByLabel('What it means').fill('Has the right background.');
    await dialog.getByLabel('Evidence that counts').fill('Employment history');
    for (const level of [1, 3, 5]) await dialog.getByRole('textbox', { name: `Level ${level}` }).fill('Any');
    await dialog.getByRole('group', { name: 'Applies to job types' }).getByLabel('Software engineering').check();
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog.getByRole('alert')).toHaveText('A competency is a skill with evidence, never an employer.');
    await expect(dialog.getByLabel('Name')).toHaveAttribute('aria-invalid', 'true');
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(competency(page, 'Worked at a top insurer')).toHaveCount(0);
  });

  test('Scenario: A published competency is retired, never deleted', async ({ page }) => {
    await openCatalogue(page);
    await packSummary(page, 'Payments and fintech').click();
    await expect(page.getByRole('button', { name: `Remove ${LEDGER}` })).toHaveCount(0);
    await page.getByRole('button', { name: `Retire ${LEDGER}` }).click();
    await expect(competency(page, LEDGER)).toContainText('Retired');
    await expect(competency(page, LEDGER).getByRole('button')).toHaveCount(0);
  });

  for (const theme of themes) {
    test(`axe passes on the draft and its competency form (${theme})`, async ({ page, context, baseURL }) => {
      await context.addCookies([{ name: 'theme', value: theme, url: baseURL ?? '' }]);
      await openCatalogue(page);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await packSummary(page, 'Insurance and insurtech').click();
      await expectAccessible(page);
      await page.getByRole('button', { name: 'Edit Claims processing systems' }).click();
      await expect(page.getByRole('dialog', { name: 'Edit competency' })).toBeVisible();
      await expectAccessible(page);
    });
  }
});

// AIV-P2-047: job types in the draft. Runs after "the draft" above, on the draft it opened.
const rows = (page: Page) => page.getByRole('list', { name: 'Job types in the draft' }).getByRole('listitem');
const row = (page: Page, name: string) =>
  rows(page).filter({ has: page.getByRole('heading', { level: 3, name, exact: true }) });

async function addJobType(page: Page, fields: { key: string; starters: string[] }) {
  await page.getByRole('button', { name: 'Add a job type' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add a job type' });
  await dialog.getByLabel('Key').fill(fields.key);
  await dialog.getByLabel('English label').fill('Cloud security');
  await dialog.getByLabel('Evidence that counts').fill('Cloud security reviews and fixed misconfigurations');
  for (const [i, starter] of fields.starters.entries())
    await dialog.getByLabel(`Starter competency ${i + 1}`).fill(starter);
  await dialog.getByRole('button', { name: 'Save' }).click();
  return dialog;
}

test.describe('job types in the draft', () => {
  test('Scenario: Adding a job type, by keyboard, at the position chosen', async ({ page }) => {
    await openCatalogue(page);
    await page.getByRole('button', { name: 'Add a job type' }).focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Add a job type' });
    await expect(dialog.getByLabel('Key')).toBeFocused();
    await page.keyboard.type('security_engineering');
    await page.keyboard.press('Tab');
    await page.keyboard.type('Security engineering');
    await page.keyboard.press('Tab');
    await page.keyboard.type('Threat models, security reviews, fixed vulnerabilities');
    for (const starter of ['Threat modelling', 'Secure code review', 'Incident response', 'Identity and access']) {
      await page.keyboard.press('Tab');
      await page.keyboard.type(starter);
    }
    await page.keyboard.press('Tab');
    await expect(dialog.getByLabel('Position in Add a job')).toBeFocused();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('3');
    await page.keyboard.press('Enter');
    await expect(dialog).toBeHidden();
    await expect(rows(page).nth(2)).toContainText('Security engineering');
    await expect(rows(page).nth(2)).toContainText('New in draft');

    // Recruiters read the published version: still the ten job types (Alex, the e2e seed's recruiter, for Riya).
    await signIn(page, { email: 'alex@example.com' });
    await page.goto('/app/jobs/new');
    const jobType = page.getByLabel('Job type');
    await expect(jobType.locator('option:not([value=""])')).toHaveCount(10);
    await expect(jobType.locator('option', { hasText: 'Security engineering' })).toHaveCount(0);
  });

  test('Scenario: A job type needs exactly four starters', async ({ page }) => {
    await openCatalogue(page);
    const dialog = await addJobType(page, {
      key: 'cloud_security',
      starters: ['Cloud IAM', 'Network policy', 'Audit'],
    });
    await expect(dialog.getByRole('alert')).toHaveText('Add exactly four starter competencies.');
  });

  test('Scenario Outline: Keys are checked', async ({ page }) => {
    await openCatalogue(page);
    const starters = ['Cloud IAM', 'Network policy', 'Audit logging', 'Secrets handling'];
    for (const [key, message] of [
      ['software_engineering', 'This key is already used.'],
      ['Security Engineering', 'Use lower-case letters, digits and underscores.'],
    ] as const) {
      const dialog = await addJobType(page, { key, starters });
      await expect(dialog.getByRole('alert')).toHaveText(message);
      await expect(dialog.getByLabel('Key')).toHaveAttribute('aria-invalid', 'true');
      await dialog.getByRole('button', { name: 'Cancel' }).click();
    }
  });

  test('Scenario: Starter competencies follow the fairness rule', async ({ page }) => {
    await openCatalogue(page);
    const dialog = await addJobType(page, {
      key: 'cloud_security',
      starters: ['Cloud IAM', 'Network policy', 'Audit logging', 'Ex-Big Four experience'],
    });
    await expect(dialog.getByRole('alert')).toHaveText('A competency is a skill with evidence, never an employer.');
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(row(page, 'Cloud security')).toHaveCount(0);
  });

  test('Scenario: A published job type is retired, never deleted', async ({ page }) => {
    await openCatalogue(page);
    await expect(page.getByRole('button', { name: 'Remove Technical writing and support' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Retire Technical writing and support' }).click();
    await expect(row(page, 'Technical writing and support')).toContainText('Retired');
    await expect(row(page, 'Technical writing and support').getByRole('button')).toHaveCount(0);
  });

  for (const theme of themes) {
    test(`axe passes on the job types and the job type form (${theme})`, async ({ page, context, baseURL }) => {
      await context.addCookies([{ name: 'theme', value: theme, url: baseURL ?? '' }]);
      await openCatalogue(page);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await expectAccessible(page);
      await page.getByRole('button', { name: 'Edit Security engineering' }).click();
      await expect(page.getByRole('dialog', { name: 'Edit job type' })).toBeVisible();
      await expectAccessible(page);
    });
  }
});

// AIV-P2-048: the eval on the draft. No worker runs here, so each run's result is written as the worker would
// (the stubbed worker result); the worker job itself is tested in tests/integration (catalogue-eval.test.ts).
const finish = async (status: 'passed' | 'failed', result: object) => {
  const db = createDb(databaseUrl, { max: 1 });
  try {
    await db.execute(sql`update jobs.catalogue_eval_run set status = ${status}, finished_at = now(), tokens = 1200,
      result = ${JSON.stringify(result)}::jsonb where status = 'running'`);
  } finally {
    await db.$client.end();
  }
};
const detectDomain = (passed: boolean) => ({
  task: 'jobs.detectDomain',
  passed,
  fieldMatch: 0.97,
  groups: [
    { group: 'domain', n: passed ? 18 : 15, total: 18 },
    { group: 'none', n: 6, total: 6 },
    { group: 'fairness', n: 4, total: 4 },
  ],
  failedCases: passed ? [] : ['telecom-prepaid-gurugram', 'banking-sme-mumbai', 'payments-difc'],
});
const panel = (page: Page) =>
  page
    .locator('section, div')
    .filter({ has: page.getByRole('heading', { name: 'AI eval' }) })
    .last();
const runEval = async (page: Page) => {
  // Keyboard path: the button is reached and pressed without a pointer.
  await page.getByRole('button', { name: 'Run the eval' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('status').filter({ hasText: 'Eval running…' })).toBeVisible();
};

test.describe('the draft eval', () => {
  test('Scenario: A new pack without golden cases cannot pass, and its run lists what failed', async ({ page }) => {
    await openCatalogue(page);
    await expect(panel(page)).toContainText('The eval has not run on this draft.');
    await runEval(page);
    await expect(page.getByRole('button', { name: 'Run the eval' })).toBeDisabled();
    await finish('failed', { uncovered: ['insurance'], tasks: [] });
    await page.reload();
    await expect(page.getByRole('status').filter({ hasText: 'Eval failed' })).toBeVisible();
    await expect(panel(page)).toContainText('Add golden cases for insurance in packages/ai/evals before publishing.');
  });

  test('Scenario: A failing run lists the failed case ids', async ({ page }) => {
    await openCatalogue(page);
    await runEval(page);
    await finish('failed', { uncovered: [], tasks: [detectDomain(false)] });
    await page.reload();
    await expect(page.getByRole('status').filter({ hasText: 'Eval failed' })).toBeVisible();
    for (const id of ['telecom-prepaid-gurugram', 'banking-sme-mumbai', 'payments-difc'])
      await expect(panel(page).getByText(id, { exact: true })).toBeVisible();
  });

  test('Scenario: A passing run is recorded against the draft content, then an edit invalidates it', async ({
    page,
  }) => {
    await openCatalogue(page);
    await runEval(page);
    await finish('passed', { uncovered: [], tasks: [detectDomain(true)] });
    // The page polls while a run is running, so the result appears without a reload.
    await expect(page.getByRole('status').filter({ hasText: 'Eval passed' })).toBeVisible({ timeout: 15_000 });
    await expect(panel(page)).toContainText(/Ran on .+ at \d{2}:\d{2} \(Asia\/Dubai\)/);
    for (const metric of ['Domain accuracy', 'No clear domain', 'Fairness'])
      await expect(panel(page).getByText(metric, { exact: true })).toBeVisible();
    await expect(panel(page).getByText('Observed')).toHaveCount(3);

    await packSummary(page, 'Telecom').click();
    await page.getByRole('button', { name: 'Edit Telecom' }).click();
    const dialog = page.getByRole('dialog', { name: 'Edit pack' });
    await dialog.getByLabel('English label').fill('Telecoms');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog).toBeHidden();
    await expect(panel(page)).toContainText('The draft changed after the last eval run. Run it again.');
  });

  test('Scenario: Runs do not overlap', async ({ page }) => {
    await openCatalogue(page);
    // Another operator's run starts after this page loaded.
    const db = createDb(databaseUrl, { max: 1 });
    const runs = async () =>
      (await db.execute<{ n: number }>(sql`select count(*)::int as n from jobs.catalogue_eval_run`))[0]?.n;
    try {
      await db.execute(sql`insert into jobs.catalogue_eval_run (id, version, content_hash, keys, status, requested_by,
        requested_at) select gen_random_uuid(), version, repeat('0', 64), '{"domains":[],"regions":[]}', 'running',
        '0190d4a2-0000-7000-8000-00000000a002', now() from jobs.catalogue_version where status = 'draft'`);
      const before = await runs();
      await page.getByRole('button', { name: 'Run the eval' }).focus();
      await page.keyboard.press('Enter');
      // The request is refused and the page reloads to the run in progress: no second run starts.
      await expect(panel(page)).toContainText('An eval run is already in progress.');
      await expect(page.getByRole('button', { name: 'Run the eval' })).toBeDisabled();
      expect(await runs()).toBe(before);
    } finally {
      await db.$client.end();
    }
    await finish('passed', { uncovered: [], tasks: [detectDomain(true)] });
  });

  for (const theme of themes) {
    test(`axe passes on the eval result (${theme})`, async ({ page, context, baseURL }) => {
      await context.addCookies([{ name: 'theme', value: theme, url: baseURL ?? '' }]);
      await openCatalogue(page);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await runEval(page);
      await expectAccessible(page);
      await finish('failed', { uncovered: [], tasks: [detectDomain(false)] });
      await page.reload();
      await expect(page.getByRole('status').filter({ hasText: 'Eval failed' })).toBeVisible();
      await expectAccessible(page);
    });
  }
});
