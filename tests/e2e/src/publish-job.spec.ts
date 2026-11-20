import { expect, test, type Page } from '@playwright/test';
import { signIn } from './auth.ts';
import { expectAccessible, themes } from './gallery.ts';

// AIV-P1-015 J1 step: Tariq (admin of "Approvals Co", seed.ts) previews, publishes, views and unpublishes Senior AI
// Engineer (approved rubric, AED 35,000 to 48,000) from its rubric page; Senior Product Designer has only a draft. Its
// own Playwright project, after the candidate site's specs, which count the listed jobs (playwright.config.ts). What
// the listing holds (the allow-list), the audit and the events are tests/integration jobs.test.ts.

async function openRubric(page: Page, title: string) {
  await page.goto('/app/jobs');
  await page.getByRole('link', { name: title, exact: true }).click();
  await page.getByRole('link', { name: /^Competencies and rubric/ }).click();
  await expect(page).toHaveTitle(`${title}: Competencies and rubric · Credalent`);
}

const publishThis = (page: Page) => page.getByRole('button', { name: 'Publish this job' });

test('Scenarios: preview, cancel, publish, view the listing, unpublish', async ({ page, context, baseURL }) => {
  await signIn(page, { email: 'tariq@example.com' });

  // Scenario: A job without an approved rubric cannot be published.
  await openRubric(page, 'Senior Product Designer');
  await expect(publishThis(page)).toBeDisabled();
  await expect(page.getByText('Publish after the rubric is approved.')).toBeVisible();

  // Scenario: Preview before publishing, then Cancel: still unpublished.
  await openRubric(page, 'Senior AI Engineer');
  await expect(
    page.getByText(
      'Not published. Only candidates you add can apply. Publishing lists this job on the candidate site so anyone ' +
        'can apply directly.',
    ),
  ).toBeVisible();
  // axe on the open preview, in each theme: the theme is read on load, so reload and open it again.
  const preview = page.getByRole('region', { name: 'Preview: what candidates will see' });
  for (const theme of themes) {
    await context.addCookies([{ name: 'theme', value: theme, url: baseURL ?? '' }]);
    await page.reload();
    await publishThis(page).focus();
    await page.keyboard.press('Enter');
    await expect(preview).toBeVisible();
    await expectAccessible(page);
  }
  await expect(preview).toContainText(
    'Shown: title, location, pay band, the two competencies and the level each needs.',
  );
  await expect(preview).toContainText("Hidden: weights, the client's name, other candidates and all scores.");
  await expect(preview).toContainText('Applications arrive in your Inbox.');
  await preview.getByRole('button', { name: 'Cancel' }).click();
  await expect(publishThis(page)).toBeFocused();
  await page.reload();
  await expect(publishThis(page)).toBeVisible();

  // Scenario: Publish.
  await publishThis(page).click();
  await page.getByLabel('How candidates see the employer').fill('An AI product studio');
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Live on' })).toHaveText(
    'Live on the candidate site. New applications arrive in your Inbox.',
  );
  await expect(page.getByText('Published', { exact: true })).toBeVisible();
  for (const theme of themes) {
    await context.addCookies([{ name: 'theme', value: theme, url: baseURL ?? '' }]);
    await page.reload();
    await expectAccessible(page);
  }

  // The public listing: title, location and pay band; no weight.
  await page.getByRole('link', { name: 'View public listing' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Senior AI Engineer' })).toBeVisible();
  await expect(page.getByText('AED 35,000 to 48,000 a month')).toBeVisible();
  await expect(page.getByText('60%')).toHaveCount(0);
  const listing = page.url();

  // Scenario: Unpublish: the listing leaves the candidate site.
  await page.goBack();
  await page.getByRole('button', { name: 'Unpublish' }).click();
  await expect(publishThis(page)).toBeVisible();
  await page.goto(listing);
  await expect(page.getByRole('heading', { level: 1, name: 'Senior AI Engineer' })).toHaveCount(0);
});
