import { expect, test, type Page } from '@playwright/test';
import { signIn } from './auth.ts';
import { expectAccessible, themes } from './gallery.ts';

// AIV-P1-064 J1, Add a job step 2: the detected industry's pack suggestions, kept, edited or removed by the recruiter.
// The fake model answers from tests/e2e/ai-fixtures.json: detection by the job's location, drafting by its description.
// What is stored (origin domain_pack, pack key and version) is tests/integration jobs.test.ts; the duplicate filter and
// the regional guard are unit tests (features/job-new/domain/draft.test.ts, modules/jobs job.test.ts).

const SENTENCE = 'You will build the card acquiring platform that settles merchant payments across the Gulf.';
const PAYMENTS = `${SENTENCE} You will write services in TypeScript and Go, with tests. You will mentor two engineers.`;
const STUDIO = 'You will build the internal tools our studio team uses to plan their week.';
const CORE = [
  'Idempotent payment APIs and retries',
  'Ledger and double-entry accounting',
  'Reconciliation and settlement',
  'PCI DSS scope reduction and tokenisation',
];

async function draft(page: Page, title: string, description: string, location: string) {
  await signIn(page, { email: 'mira@example.com' });
  await page.goto('/app/jobs/new');
  await page.getByLabel('Job type').selectOption({ label: 'Software engineering' });
  await page.getByLabel('Job title').fill(title);
  await page.getByLabel('Location').fill(location);
  await page.getByLabel('Job description').fill(description);
  await page.getByRole('button', { name: 'Draft competencies' }).click();
}
const packTable = (page: Page, industry: string) =>
  page.getByRole('table', { name: `Suggestions from the ${industry} pack` });
const rowOf = (page: Page, name: string) => page.getByRole('row').filter({ hasText: name });
const SAVED =
  "Job saved. These competencies are now version 1 of this job's own rubric, marked as a draft. Other jobs keep " +
  'their own rubrics.';

for (const theme of themes) {
  test(`Scenario: The pack's core competencies are suggested, and I decide what stays, from the keyboard (${theme})`, async ({
    page,
    context,
    baseURL,
  }) => {
    await context.addCookies([{ name: 'theme', value: theme, url: baseURL ?? '' }]);
    await draft(page, `Senior Backend Engineer, Payments ${theme} ${Date.now()}`, PAYMENTS, 'DIFC, Dubai');

    await expect(page.getByText('Credalent read this as a Payments and fintech job')).toBeVisible();
    // The detected industry cites its sentence, in the shared highlight.
    await expect(page.locator('mark').filter({ hasText: SENTENCE }).first()).toHaveText(
      `cited from your description ${SENTENCE}`,
    );
    await expect(page.getByRole('heading', { name: 'For a Payments and fintech job · 4 suggestions' })).toBeVisible();
    for (const name of CORE) {
      const cells = packTable(page, 'Payments and fintech')
        .getByRole('row')
        .filter({ hasText: name })
        .getByRole('cell');
      await expect(cells.nth(0)).toContainText('From the Payments and fintech pack');
      await expect(cells.nth(3)).toHaveText('Desirable');
    }
    const uae = page.getByRole('table', { name: 'Regional suggestions for the UAE' });
    await expect(page.getByRole('heading', { name: 'In the UAE' })).toBeVisible();
    await expect(uae).toContainText('CBUAE payment and stored-value rules');
    await expect(uae).toContainText('Aani instant payments');
    // Scenario: No duplicates with AIV-P1-009: the generic industry suggestion gives way to the pack.
    await expect(page.getByText('Banking and payments domain')).toHaveCount(0);
    await expectAccessible(page);

    // Scenario: I decide what stays.
    await page.getByRole('button', { name: 'Remove Reconciliation and settlement' }).focus();
    await page.keyboard.press('Enter');
    await expect(rowOf(page, 'Reconciliation and settlement')).toContainText(
      'Reconciliation and settlement removed from this rubric.',
    );
    await expect(page.getByRole('button', { name: 'Restore Reconciliation and settlement' })).toBeFocused();
    await page.getByRole('button', { name: 'Add 3-D Secure and SCA flows' }).focus();
    await page.keyboard.press('Enter');
    await expect(packTable(page, 'Payments and fintech')).toContainText('3-D Secure and SCA flows');
    await expect(page.getByRole('button', { name: 'Add 3-D Secure and SCA flows' })).toHaveCount(0);

    // Scenario: Regional knowledge never becomes mandatory or a location filter.
    await page.getByRole('button', { name: 'Edit Aani instant payments' }).focus();
    await page.keyboard.press('Enter');
    const type = page.getByLabel('Type, Aani instant payments');
    await type.selectOption({ label: 'Mandatory' });
    await expect(page.getByRole('alert').filter({ hasText: 'Regional knowledge' })).toHaveText(
      'Regional knowledge is shown through evidence, so it can only be desirable.',
    );
    await expect(type).toHaveValue('desirable');
    await expectAccessible(page);
    await page.getByRole('button', { name: 'Done' }).click();
    await expect(rowOf(page, 'Aani instant payments').getByRole('cell').nth(3)).toHaveText('Desirable');

    await page.getByRole('button', { name: 'Save job and rubric' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByText(SAVED)).toBeFocused();
  });
}

test('Scenario: Wrong industry', async ({ page }) => {
  await draft(page, 'Payments Engineer, wrong industry', PAYMENTS, 'DIFC, Dubai');
  await expect(page.getByRole('heading', { name: 'For a Payments and fintech job · 4 suggestions' })).toBeVisible();

  await page.getByText('Not this industry').click();
  await page.getByRole('button', { name: 'E-commerce and marketplaces' }).click();
  await expect(page.getByRole('button', { name: 'E-commerce and marketplaces' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByText('You chose E-commerce and marketplaces for this job.')).toBeVisible();
  const ecommerce = packTable(page, 'E-commerce and marketplaces');
  await expect(ecommerce).toContainText('Catalogue and search relevance');
  await expect(ecommerce).toContainText('Cash on delivery reconciliation');
  await expect(page.getByText('Idempotent payment APIs and retries')).toHaveCount(0);
  await expect(page.getByRole('table', { name: 'Regional suggestions for the UAE' })).toContainText(
    'UAE VAT on e-commerce',
  );

  await page.getByRole('button', { name: 'No industry' }).click();
  await expect(page.getByRole('heading', { name: /^For an? .* job/ })).toHaveCount(0);
  await expect(page.getByText('Catalogue and search relevance')).toHaveCount(0);
  await expect(page.getByRole('table', { name: 'Drafted competencies' })).toContainText(
    'Card acquiring platform engineering',
  );
  // Without a pack, AIV-P1-009's industry suggestion is back.
  await expect(page.getByRole('table', { name: 'Suggested competencies' })).toContainText(
    'Banking and payments domain',
  );
});

test('Scenario: No clear domain, and nothing changes until I save', async ({ page }) => {
  const title = `Studio Tools Engineer ${Date.now()}`;
  await draft(page, title, STUDIO, 'Al Quoz studio');
  await expect(page.getByRole('table', { name: 'Drafted competencies' })).toContainText('Internal tools engineering');
  await expect(page.getByText(/Credalent read this as/)).toHaveCount(0);
  await expect(page.getByRole('heading', { name: /^For an? .* job/ })).toHaveCount(0);

  // AIV-P1-165 "Add industry skills is a real button": a <button>, reached by Tab, opened by Enter and by Space.
  const add = page.getByRole('button', { name: 'Add industry skills' });
  expect(await add.evaluate((element) => element.tagName)).toBe('BUTTON');
  await page.getByRole('button', { name: 'Remove' }).last().focus();
  await page.keyboard.press('Tab');
  await expect(add).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(add).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Space');
  await expect(page.getByRole('list', { name: 'Industries' })).toBeHidden();
  await page.keyboard.press('Space');
  const packs = page.getByRole('list', { name: 'Industries' }).getByRole('button');
  await expect(packs).toHaveText([
    'Payments and fintech',
    'Banking and Islamic finance',
    'Healthcare',
    'E-commerce and marketplaces',
    'Logistics and mobility',
    'Government and public sector',
    'Telecom',
    'Energy and utilities',
    'No industry',
  ]);
  await expectAccessible(page);
  await packs.filter({ hasText: 'Healthcare' }).click();
  await expect(page.getByRole('heading', { name: /^For a Healthcare job · \d suggestions?$/ })).toBeVisible();

  // Scenario: Nothing changes until I save.
  await page.goto('/app/jobs');
  await expect(page.getByRole('heading', { level: 1, name: 'Jobs' })).toBeVisible();
  await expect(page.getByText(title)).toHaveCount(0);
});
