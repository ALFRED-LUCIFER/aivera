import { expect } from '@playwright/test';
import { test } from './auth.ts';
import { expectAccessible } from './gallery.ts';

// AIV-P0-032: the J0 smoke journey on the seeded synthetic workspace, the role fixtures, and the axe helper.

test('Scenario: J0 smoke journey', async ({ recruiter: page }) => {
  // No 120 ms colour transition after the theme switch, so axe reads the settled dark colours.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByRole('heading', { level: 1, name: 'My desk' })).toBeVisible();
  await expect(page.getByText('Synthetic demo data')).toBeVisible();
  const primary = page.getByRole('navigation', { name: 'Primary' });
  await expect(primary.getByRole('link', { name: 'My desk 4' })).toBeVisible();
  await expectAccessible(page);
  await page.getByRole('button', { name: 'Switch to dark theme' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expectAccessible(page);
  await primary.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
  await expectAccessible(page);
});

test('the hiring owner fixture is signed in, without the recruiter desk', async ({ hiringOwner: page, context }) => {
  expect((await context.cookies()).some((c) => c.name === '__Host-credalent-session')).toBe(true);
  // My desk needs the recruiter capability (navigation.ts); a hiring owner reaches only the jobs she is granted.
  await page.goto('/app');
  await expect(page.getByRole('heading', { level: 1, name: '404' })).toBeVisible();
});

test('the candidate fixture lands on My applications', async ({ candidate: page }) => {
  await expect(page).toHaveURL(/\/candidates\/me$/);
  await expect(page.getByRole('heading', { level: 1, name: 'My applications' })).toBeVisible();
});

test('the anonymous fixture is sent to sign in', async ({ anonymous: page }) => {
  await page.goto('/app');
  await expect(page).toHaveURL(/\/sign-in\?next=%2Fapp$/);
});

// SAFETY: mutation check: emptied the body of expectAccessible -> this test failed
test('Scenario: Every visited page is checked by axe', async ({ anonymous: page }) => {
  // A deliberately failing page: an image with no text alternative is a critical violation (axe rule image-alt).
  await page.setContent('<html lang="en"><title>Fixture</title><main><img id="no-alt" src="data:,"></main></html>');
  await expect(expectAccessible(page)).rejects.toThrow(/"image-alt"[\s\S]*"critical"[\s\S]*"#no-alt"/);
});
