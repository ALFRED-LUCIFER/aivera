import { defineConfig, devices } from '@playwright/test';

// Not 3000: that is the owner's local preview. `next dev` because the gallery (and the shell's signed-in stand-in) exist
// only when NODE_ENV=development.
const port = 3200;
const ci = Boolean(process.env['CI']);

export default defineConfig({
  testDir: 'src',
  forbidOnly: ci,
  retries: ci ? 1 : 0,
  reporter: ci ? [['github'], ['html', { open: 'never' }]] : [['list']],
  // Baselines are Linux only (CI on ubuntu, or the Playwright Docker image through `pnpm e2e:update`): macOS renders
  // text differently, so elsewhere screenshot assertions are skipped and every other check still runs.
  ignoreSnapshots: process.platform !== 'linux',
  expect: { toHaveScreenshot: { animations: 'disabled', stylePath: './hide-dev-overlay.css' } },
  use: { baseURL: `http://localhost:${port}`, trace: 'retain-on-failure' },
  projects: [{ name: 'gallery', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `pnpm --filter web exec next dev --port ${port}`,
    url: `http://localhost:${port}/dev/gallery`,
    // Never reuse: a server on this port may belong to another worktree's code.
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
