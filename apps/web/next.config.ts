import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { NextConfig } from 'next';
import { PHASE_DEVELOPMENT_SERVER } from 'next/constants';

// Local development keeps one .env.local at the repository root (runbook); Next.js only reads apps/web by itself.
const rootEnv = join(import.meta.dirname, '..', '..', '.env.local');
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const config: NextConfig = {
  // Set only by tests/e2e/playwright.config.ts: its second `next dev` (no candidate sign-in) needs its own folder.
  distDir: process.env['NEXT_DIST_DIR'] ?? '.next',
  poweredByHeader: false,
  typedRoutes: true,
  // Workspace packages ship TypeScript source (ADR-002).
  transpilePackages: [
    '@aivera/ui',
    '@aivera/tokens',
    '@aivera/i18n',
    '@aivera/db',
    '@aivera/identity',
    '@aivera/jobs',
    '@aivera/candidates',
    '@aivera/candidate-accounts',
    '@aivera/workspaces',
    '@aivera/audit',
    '@aivera/notifications',
    '@aivera/observability',
  ],
  // The distro patches Node modules at runtime and reads files next to itself; bundled, it never starts (AIV-P0-018).
  serverExternalPackages: ['@azure/monitor-opentelemetry'],
  // `forbidden()` and app/forbidden.tsx: a refused request context renders a 403 page (AIV-P0-010).
  experimental: { authInterrupts: true },
  // The container image runs the standalone server; trace from the repo root so workspace packages are included.
  output: 'standalone',
  outputFileTracingRoot: join(import.meta.dirname, '..', '..'),
};

// `page.dev.tsx` routes (the /dev/gallery component gallery) exist only under `next dev`: a build never sees them, so
// none of their code or demo text reaches a production bundle.
export default (phase: string): NextConfig =>
  phase === PHASE_DEVELOPMENT_SERVER ? { ...config, pageExtensions: ['dev.tsx', 'tsx', 'ts', 'jsx', 'js'] } : config;
