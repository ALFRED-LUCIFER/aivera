import { expect, test, type Page } from '@playwright/test';
import { expectNoAxeViolations, themes } from './gallery.ts';

// J7 step 1: the website hero (AIV-P5-001).

const scoreName = 'Backed score 72, up to 85 if her open claim holds';
const card = (page: Page) => page.locator('.mk-card');
// The counting number alone, not the caption beside it.
const count = (page: Page) => card(page).getByRole('img').locator('> span').first();

test('Scenario: The hero states the promise', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Hire on evidence, not claims.' })).toBeVisible();
  await expect(
    page.getByText('No tests to sit. No automatic rejections. A person makes every hiring decision.'),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'Create your workspace' }).first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'See the product' })).toBeVisible();
});

// SAFETY: mutation check: removed aria-label={l.scoreName} from the score -> this test failed (no img with that name)
test('Scenario: The score animates to its final values, under one unchanging name', async ({ page }) => {
  // A short phone screen puts the card well below the fold, so the intro always waits for the scroll: no race.
  await page.setViewportSize({ width: 390, height: 600 });
  await page.goto('/');
  // Hydrated and waiting below the fold; scrolling earlier would show the final card before the intro could start.
  await expect(card(page)).toHaveAttribute('data-stage', 'ready');
  await card(page).scrollIntoViewIfNeeded();
  const score = page.getByRole('img', { name: scoreName });
  const seen = new Set<number>();
  await expect
    .poll(async () => {
      seen.add(Number(await count(page).textContent()));
      await expect(score).toHaveAccessibleName(scoreName);
      return seen.has(72) && seen.size > 1;
    })
    .toBe(true);
  // It counted: some value below 72 was on screen before the final one.
  expect([...seen].some((n) => n < 72)).toBe(true);
  await expect(card(page).getByText('72 backed by evidence · up to 85 if her open claim holds')).toBeVisible();
  await expect(card(page).locator('mark')).toContainText('wrote 148 of 171 test cases');
});

test.describe('reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  // SAFETY: mutation check: removed the reducedMotion guard in playsIntro -> this test failed (score read 0)
  test('Scenario: Reduced motion shows the final state', async ({ page }) => {
    await page.goto('/');
    const score = page.getByRole('img', { name: scoreName });
    await expect(score).toBeVisible();
    await expect(count(page)).toHaveText('72', { timeout: 500 });
    await expect(card(page)).toHaveAttribute('data-stage', 'final');
    expect(
      await page
        .locator('.mk-rise')
        .first()
        .evaluate((el) => getComputedStyle(el).animationName),
    ).toBe('none');
  });

  for (const theme of themes) {
    test(`Scenario: Accessible and readable (${theme})`, async ({ page, context, baseURL }) => {
      await context.addCookies([{ name: 'theme', value: theme, url: baseURL ?? '' }]);
      await page.goto('/');
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await expectNoAxeViolations(page);
      await expect(card(page)).toHaveScreenshot(`website-hero-card-${theme}.png`);
    });
  }
});

test('Scenario: The demo person is labelled synthetic', async ({ page }) => {
  await page.goto('/');
  await expect(card(page).getByText('Illustrative candidate, synthetic data.')).toBeVisible();
});

test('Scenario: Calls to action', async ({ page }) => {
  await page.goto('/');
  // Where sign-up leads is signup.spec.ts (AIV-P1-059).
  const createLinks = page.getByRole('link', { name: 'Create your workspace' });
  // The hero and the pilot section.
  await expect(createLinks).toHaveCount(2);
  for (const link of await createLinks.all()) await expect(link).toHaveAttribute('href', '/signup');
  await page.getByRole('banner').getByRole('link', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
});

test('the header keyboard path reaches every link in order', async ({ page }) => {
  await page.goto('/');
  const names = [
    'Skip to content',
    'Aivera home',
    'How it works',
    'Roles we cover',
    'Why trust it',
    'For candidates',
    'Sign in',
  ];
  for (const name of names) {
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name, exact: true }).first()).toBeFocused();
  }
});

// J7 step 2: how it works (AIV-P5-002).

test('Scenario: The three-line contrast', async ({ page }) => {
  await page.goto('/');
  for (const line of [
    'A CV tells you what someone claims.',
    'A test tells you how they do on a test.',
    'Their work tells you what they have done.',
  ]) {
    await page.getByText(line).scrollIntoViewIfNeeded();
    await expect(page.getByText(line)).toBeVisible();
  }
});

test('Scenario Outline: The five steps', async ({ page }) => {
  await page.goto('/');
  const section = page.getByRole('region', { name: 'From job description to a decision you can defend' });
  await expect(section.getByRole('listitem').getByRole('heading', { level: 3 })).toHaveText([
    'Agree what matters',
    'Collect the work',
    'See why each person ranks where they do',
    'Interview only what is unproven',
    'Decide with the pack in front of you',
  ]);
});

// SAFETY: mutation check: removed tabIndex={-1} from the How it works heading -> this test failed (focus stayed on the link)
test('Scenario: The header anchor scrolls here and moves focus to the heading', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('banner').getByRole('link', { name: 'How it works' }).click();
  const heading = page.getByRole('heading', { level: 2, name: 'From job description to a decision you can defend' });
  await expect(heading).toBeFocused();
  await expect(heading).toBeInViewport();
  // Not hidden under the sticky header, once the smooth scroll has settled.
  const header = await page.getByRole('banner').evaluate((el) => el.getBoundingClientRect().bottom);
  let last = Number.NaN;
  await expect
    .poll(async () => {
      const top = await heading.evaluate((el) => el.getBoundingClientRect().top);
      const settled = top === last;
      last = top;
      return settled;
    })
    .toBe(true);
  expect(last).toBeGreaterThanOrEqual(header);
});

/** Every scroll reveal at full opacity: Playwright's toBeVisible and axe both pass over opacity 0, so read it. */
const revealOpacities = (page: Page) =>
  page.locator('.mk-reveal').evaluateAll((els) => [...new Set(els.map((el) => getComputedStyle(el).opacity))]);

test.describe('content never waits for a reveal', () => {
  test.describe('reduced motion', () => {
    test.use({ reducedMotion: 'reduce' });
    // SAFETY: mutation check: deleted the reduced-motion .mk-reveal rule in marketing.css -> this test failed (0)
    test('every section is fully visible without scrolling', async ({ page }) => {
      await page.goto('/');
      await expect.poll(() => revealOpacities(page)).toEqual(['1']);
    });
  });

  test.describe('no JavaScript', () => {
    test.use({ javaScriptEnabled: false });
    // SAFETY: mutation check: deleted the <noscript> style in MarketingHome.tsx -> this test failed (0)
    test('every section is fully visible', async ({ page }) => {
      await page.goto('/');
      expect(await revealOpacities(page)).toEqual(['1']);
      await expect(page.getByRole('heading', { level: 1, name: 'Hire on evidence, not claims.' })).toBeVisible();
    });
  });
});

// J7 step 3: role families (AIV-P5-003).

test('Scenario Outline: The table lists evidence per role family', async ({ page }) => {
  await page.goto('/');
  const table = page.getByRole('table');
  for (const [family, evidence] of [
    ['QA and test automation', 'Test suites, bug reports, CI history, test plans'],
    ['Sales', 'Closed deals, client references, pipeline records, market write-ups'],
    ['Forward deployed engineering', 'Customer deployments, integration code, solution write-ups, customer references'],
    ['Technical writing and support', 'Published documentation, resolved tickets, help articles'],
  ] as const) {
    await expect(table.getByRole('row', { name: family })).toContainText(evidence);
  }
  await expect(table.getByRole('rowheader')).toHaveCount(10);
});

test('Scenario: No public work', async ({ page }) => {
  await page.goto('/');
  const note = page.getByText(
    'No public work? Many testers, analysts and support specialists have none. Aivera requests a short work sample scoped to the role instead.',
  );
  await note.scrollIntoViewIfNeeded();
  await expect(note).toBeInViewport();
  // Its reveal has finished: visible means full opacity, which toBeVisible alone does not check.
  await expect(note.locator('xpath=ancestor::*[contains(@class,"mk-reveal")]')).toHaveCSS('opacity', '1');
});

test('the header "Roles we cover" link moves focus to the section heading', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('banner').getByRole('link', { name: 'Roles we cover' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Not only software engineers' })).toBeFocused();
});

// J7 step 4: trust, pilot promise and footer (AIV-P5-004).

test('Scenario Outline: The four principles', async ({ page }) => {
  await page.goto('/');
  const trust = page.getByRole('region', { name: 'Recommendations you can check. Decisions that stay yours.' });
  for (const [title, line] of [
    ['Every score cites its source', 'Open any assessment and see the exact commit, document or reference it rests on'],
    ['Claims are labelled as claims', 'Nothing is called verified unless a second source confirms it.'],
    ['Nobody is rejected automatically', 'Ranking orders your attention. Lower-ranked candidates stay visible'],
    ['Numbers say what they are', 'Observed, baseline or projection. If no hire has completed, the dashboard says so'],
  ] as const) {
    await expect(trust.getByRole('listitem').filter({ hasText: title })).toContainText(line);
  }
});

test('Scenario: The pilot promise', async ({ page }) => {
  await page.goto('/');
  const promise = page.getByText(
    'Run a pilot on one role. It passes if you hold 30% fewer interviews per hire than your own baseline. You bring the baseline; Aivera shows the working.',
  );
  await promise.scrollIntoViewIfNeeded();
  await expect(promise).toBeInViewport();
  await expect(promise.locator('xpath=ancestor::*[contains(@class,"mk-reveal")]')).toHaveCSS('opacity', '1');
});

test('Scenario: Footer', async ({ page }) => {
  await page.goto('/');
  const footer = page.getByRole('contentinfo');
  await expect(footer.getByText('Aivera', { exact: true })).toBeVisible();
  await expect(footer.getByRole('link')).toHaveText(['How it works', 'Roles we cover', 'Why trust it', 'Sign in']);
  await expect(footer.getByText(`© ${new Date().getUTCFullYear()} Aivera`)).toBeVisible();
});

test('Scenario: Anchors from the header', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('banner').getByRole('link', { name: 'Why trust it' }).click();
  const heading = page.getByRole('heading', {
    level: 2,
    name: 'Recommendations you can check. Decisions that stay yours.',
  });
  await expect(heading).toBeFocused();
  await expect(heading).toBeInViewport();
});

for (const theme of themes) {
  test(`the whole website passes axe once every section has revealed (${theme})`, async ({
    page,
    context,
    baseURL,
  }) => {
    await context.addCookies([{ name: 'theme', value: theme, url: baseURL ?? '' }]);
    await page.goto('/');
    // Scroll through every reveal, so axe checks each section's colours at full opacity, not skipped at 0.
    for (const reveal of await page.locator('.mk-reveal').all()) {
      await reveal.scrollIntoViewIfNeeded();
      await expect(reveal).toHaveCSS('opacity', '1');
    }
    await expectNoAxeViolations(page);
  });
}
