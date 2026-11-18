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
  await expect(page.getByRole('link', { name: 'Create your workspace' })).toBeVisible();
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
  await page.getByRole('link', { name: 'Create your workspace' }).click();
  // Sign-up starts on the sign-in page until /signup ships (AIV-P1-059).
  await expect(page).toHaveURL(/\/sign-in$/);
  await page.goto('/');
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
  // Not hidden under the sticky header.
  const [top, header] = await Promise.all([
    heading.evaluate((el) => el.getBoundingClientRect().top),
    page.getByRole('banner').evaluate((el) => el.getBoundingClientRect().bottom),
  ]);
  expect(top).toBeGreaterThanOrEqual(header);
});
