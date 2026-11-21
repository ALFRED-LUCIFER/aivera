import { defineConfig, devices } from '@playwright/test';

// AIV-P1-092: the production content security policy has no 'unsafe-eval' and sends HSTS, and `next dev` (the main
// config) gets neither. This config runs the built app (`next build`, `next start`) in its own folder and port, so the
// production policy is loaded in a real browser once. CI runs it in the publish-unconfigured shard (pr.yml).
const port = 3204;
/** Test-only; it opens nothing anywhere else. The spec mints a session cookie with it. */
export const e2eAuthSecret = 'e2e-only-not-a-secret-e2e-only-not-a-secret';
export const databaseUrl =
  process.env['E2E_DATABASE_URL'] ?? 'postgres://aivera_app:local_dev_only@localhost:5432/aivera';

export default defineConfig({
  testDir: 'production',
  // The synthetic cast's workspaces: the recruiter pages need an active workspace.
  globalSetup: ['./seed.ts'],
  forbidOnly: Boolean(process.env['CI']),
  reporter: process.env['CI'] ? [['github']] : [['list']],
  use: { baseURL: `http://localhost:${port}`, ...devices['Desktop Chrome'] },
  webServer: {
    command: `pnpm --filter web exec next build && pnpm --filter web exec next start --port ${port}`,
    url: `http://localhost:${port}/api/health`,
    reuseExistingServer: false,
    timeout: 600_000,
    // Test-only values; the sign-in pages only render here, no provider is called.
    env: {
      APP_ENV: 'local',
      DATABASE_URL: databaseUrl,
      NEXT_DIST_DIR: '.next-e2e-production',
      AUTH_SECRET: e2eAuthSecret,
      AUTH_ENTRA_ISSUER: 'http://localhost:3299',
      AUTH_ENTRA_CLIENT_ID: 'credalent-e2e',
      AUTH_ENTRA_CLIENT_SECRET: 'e2e-only',
      AUTH_ENTRA_CANDIDATE_CLIENT_ID: 'credalent-e2e-candidate',
      AUTH_ENTRA_CANDIDATE_CLIENT_SECRET: 'e2e-only',
      AUTH_URL: `http://localhost:${port}`,
    },
  },
});
