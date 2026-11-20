import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

// Not 3000: that is the owner's local preview. `next dev` because the gallery exists only when
// NODE_ENV=development.
const port = 3200;
// A second app with recruiter sign-in but no candidate sign-in settings, as on Azure dev today (AIV-P0-011), and no
// operator list (AIV-P2-035): the unconfigured project's fail-closed checks.
const unconfiguredPort = 3201;
const oidcPort = 3299;
const googlePort = 3298;
/** The dev server's database; specs that set up rows directly use it too. */
export const databaseUrl =
  process.env['E2E_DATABASE_URL'] ?? 'postgres://aivera_app:local_dev_only@localhost:5432/aivera';
const oidc = `http://localhost:${oidcPort}`;
const google = `http://localhost:${googlePort}`;
const ci = Boolean(process.env['CI']);
/** Test-only session secret for the mocked provider; it opens nothing anywhere else. sign-in.spec.ts reads tokens with it. */
export const e2eAuthSecret = 'e2e-only-not-a-secret-e2e-only-not-a-secret';
// Test-only values for the mocked provider; they open nothing anywhere else.
const recruiterAuth = {
  AUTH_SECRET: e2eAuthSecret,
  AUTH_ENTRA_ISSUER: oidc,
  AUTH_ENTRA_CLIENT_ID: 'credalent-e2e',
  AUTH_ENTRA_CLIENT_SECRET: 'e2e-only',
};

export default defineConfig({
  testDir: 'src',
  // The synthetic cast's workspaces (AIV-P0-010).
  globalSetup: ['./seed.ts', './warm.ts'],
  forbidOnly: ci,
  retries: ci ? 1 : 0,
  reporter: ci ? [['github'], ['html', { open: 'never' }]] : [['list']],
  // Baselines are Linux only (CI on ubuntu, or the Playwright Docker image through `pnpm e2e:update`): macOS renders
  // text differently, so elsewhere screenshot assertions are skipped and every other check still runs.
  ignoreSnapshots: process.platform !== 'linux',
  expect: { toHaveScreenshot: { animations: 'disabled', stylePath: './hide-dev-overlay.css' } },
  // The HTML report carries both, and CI uploads it when a test fails (AIV-P0-032).
  use: { baseURL: `http://localhost:${port}`, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  // CI shards by project (AIV-P0-929, pr.yml "e2e-shard"): "gallery" in three, then "publish" and "unconfigured" with
  // --no-deps against their own database, since plain --shard keeps "publish" and "gallery" in one shard.
  projects: [
    {
      name: 'gallery',
      testIgnore: [/\.unconfigured\.spec\.ts$/, /publish-job\.spec\.ts$/],
      use: { ...devices['Desktop Chrome'] },
    },
    // AIV-P1-015: publishing adds a listing to the candidate site, whose specs count its jobs, so locally it runs after
    // them and is skipped, not passed, when any gallery test fails. CI runs it with --no-deps on its own database.
    {
      name: 'publish',
      testMatch: /publish-job\.spec\.ts$/,
      dependencies: ['gallery'],
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'unconfigured',
      testMatch: /\.unconfigured\.spec\.ts$/,
      use: { ...devices['Desktop Chrome'], baseURL: `http://localhost:${unconfiguredPort}` },
    },
  ],
  webServer: [
    {
      // Stands in for the Entra External ID tenant (AIV-P0-009).
      command: `node mock-oidc.ts`,
      url: `${oidc}/.well-known/openid-configuration`,
      reuseExistingServer: false,
      env: { MOCK_OIDC_PORT: String(oidcPort) },
    },
    {
      // Stands in for Google (AIV-P0-928): its own issuer, which identity does not trust without email_verified true.
      command: `node mock-oidc.ts`,
      url: `${google}/.well-known/openid-configuration`,
      reuseExistingServer: false,
      env: { MOCK_OIDC_PORT: String(googlePort), MOCK_OIDC_SENDS_EMAIL_VERIFIED: '1' },
    },
    {
      command: `pnpm --filter web exec next dev --port ${port}`,
      url: `http://localhost:${port}/dev/gallery`,
      // Never reuse: a server on this port may belong to another worktree's code.
      reuseExistingServer: false,
      timeout: 180_000,
      // The server refuses to start without valid config (AIV-P0-007). Sign-in writes identity.user, so a migrated
      // database must be running (docker compose locally, a service container in CI).
      env: {
        APP_ENV: 'local',
        DATABASE_URL: databaseUrl,
        ...recruiterAuth,
        // The candidate app registration on the same mocked tenant (AIV-P0-011).
        AUTH_ENTRA_CANDIDATE_CLIENT_ID: 'credalent-e2e-candidate',
        AUTH_ENTRA_CANDIDATE_CLIENT_SECRET: 'e2e-only',
        // "Continue with Google" straight to Google (AIV-P0-928), played by the second mocked provider; the unconfigured
        // app below has no Google settings, so it shows no Google button.
        AUTH_GOOGLE_ISSUER: google,
        AUTH_GOOGLE_CLIENT_ID: 'credalent-e2e-google',
        AUTH_GOOGLE_CLIENT_SECRET: 'e2e-only',
        // The synthetic operators (AIV-P2-035, personas.md), one in mixed case; the unconfigured app below has none.
        PLATFORM_OPERATOR_EMAILS: 'pia.platform@example.com,Theo.Platform@example.com',
        // AIV-P1-003: invitations queue their email (AIV-P0-017); a test-only key that seals nothing anywhere else.
        NOTIFICATIONS_ENCRYPTION_KEY: Buffer.from('e2e-only-not-a-secret-e2e-only!!').toString('base64'),
        AUTH_URL: `http://localhost:${port}`,
        // AIV-P1-008: the fake model answers "Draft competencies" from recorded fixtures, by description text.
        AI_PROVIDER: 'fake',
        AI_FAKE_FIXTURES: join(import.meta.dirname, 'ai-fixtures.json'),
      },
    },
    {
      // Its own build folder: `next dev` locks the folder, so two servers cannot share `.next`.
      command: `pnpm --filter web exec next dev --port ${unconfiguredPort}`,
      url: `http://localhost:${unconfiguredPort}/api/health`,
      reuseExistingServer: false,
      timeout: 180_000,
      env: { APP_ENV: 'local', DATABASE_URL: databaseUrl, NEXT_DIST_DIR: '.next-e2e-unconfigured', ...recruiterAuth },
    },
  ],
});
