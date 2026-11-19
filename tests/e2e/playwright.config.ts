import { defineConfig, devices } from '@playwright/test';

// Not 3000: that is the owner's local preview. `next dev` because the gallery exists only when
// NODE_ENV=development.
const port = 3200;
const oidcPort = 3299;
const oidc = `http://localhost:${oidcPort}`;
const ci = Boolean(process.env['CI']);
/** Test-only session secret for the mocked provider; it opens nothing anywhere else. sign-in.spec.ts reads tokens with it. */
export const e2eAuthSecret = 'e2e-only-not-a-secret-e2e-only-not-a-secret';

export default defineConfig({
  testDir: 'src',
  // The synthetic cast's workspaces (AIV-P0-010).
  globalSetup: './seed.ts',
  forbidOnly: ci,
  retries: ci ? 1 : 0,
  reporter: ci ? [['github'], ['html', { open: 'never' }]] : [['list']],
  // Baselines are Linux only (CI on ubuntu, or the Playwright Docker image through `pnpm e2e:update`): macOS renders
  // text differently, so elsewhere screenshot assertions are skipped and every other check still runs.
  ignoreSnapshots: process.platform !== 'linux',
  expect: { toHaveScreenshot: { animations: 'disabled', stylePath: './hide-dev-overlay.css' } },
  use: { baseURL: `http://localhost:${port}`, trace: 'retain-on-failure' },
  projects: [{ name: 'gallery', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      // Stands in for the Entra External ID tenant (AIV-P0-009).
      command: `node mock-oidc.ts`,
      url: `${oidc}/.well-known/openid-configuration`,
      reuseExistingServer: false,
      env: { MOCK_OIDC_PORT: String(oidcPort) },
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
        DATABASE_URL: process.env['E2E_DATABASE_URL'] ?? 'postgres://aivera_app:local_dev_only@localhost:5432/aivera',
        // Test-only values for the mocked provider; they open nothing anywhere else.
        AUTH_SECRET: e2eAuthSecret,
        AUTH_ENTRA_ISSUER: oidc,
        AUTH_ENTRA_CLIENT_ID: 'aivera-e2e',
        AUTH_ENTRA_CLIENT_SECRET: 'e2e-only',
      },
    },
  ],
});
