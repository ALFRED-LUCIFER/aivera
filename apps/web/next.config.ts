import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { NextConfig } from 'next';
import { PHASE_DEVELOPMENT_SERVER, PHASE_PRODUCTION_BUILD, PHASE_PRODUCTION_SERVER } from 'next/constants';

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
    '@credalent/ui',
    '@credalent/tokens',
    '@credalent/i18n',
    '@credalent/db',
    '@credalent/identity',
    '@credalent/jobs',
    '@credalent/candidates',
    '@credalent/intake',
    '@credalent/evidence',
    '@credalent/candidate-accounts',
    '@credalent/workspaces',
    '@credalent/audit',
    '@credalent/notifications',
    '@credalent/files',
    '@credalent/observability',
  ],
  // The distro patches Node modules at runtime and reads files next to itself; bundled, it never starts (AIV-P0-018).
  serverExternalPackages: ['@azure/monitor-opentelemetry'],
  // `forbidden()` and app/forbidden.tsx: a refused request context renders a 403 page (AIV-P0-010).
  experimental: { authInterrupts: true },
  // The container image runs the standalone server; trace from the repo root so workspace packages are included.
  output: 'standalone',
  outputFileTracingRoot: join(import.meta.dirname, '..', '..'),
};

type Header = { key: string; value: string };

/**
 * Security headers for every route (AIV-P1-092). Hosts are wildcards, not env values, because `headers()` is fixed at
 * build while the Blob and tenant settings arrive at run time. `form-action` lists the sign-in hosts because browsers
 * apply it to the redirect after a form post (Auth.js sign-in). `next dev` needs eval for HMR and talks to the mocked
 * sign-in hosts on localhost.
 */
export function securityHeaders(phase: string): Header[] {
  const dev = phase === PHASE_DEVELOPMENT_SERVER;
  const csp = [
    "default-src 'self'",
    // shortcut: 'unsafe-inline' scripts, because Next.js inlines its hydration payload and a nonce needs the proxy on
    // every route, which makes each page dynamic; upgrade to a proxy nonce with 'strict-dynamic' when that cost is accepted.
    `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ''}`,
    // Tailwind and Radix set inline styles.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    // The browser uploads straight to Blob storage with a signed URL (AIV-P0-016).
    `connect-src 'self' https://*.blob.core.windows.net${dev ? ' ws://localhost:* http://localhost:*' : ''}`,
    "object-src 'none'",
    "base-uri 'self'",
    `form-action 'self' https://*.ciamlogin.com https://accounts.google.com${dev ? ' http://localhost:*' : ''}`,
    "frame-ancestors 'none'",
  ].join('; ');
  return [
    { key: 'Content-Security-Policy', value: csp },
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
    // Never on localhost: browsers would pin http://localhost to https for a year.
    ...(phase === PHASE_PRODUCTION_BUILD || phase === PHASE_PRODUCTION_SERVER
      ? [{ key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' }]
      : []),
  ];
}

// `page.dev.tsx` routes (the /dev/gallery component gallery) exist only under `next dev`: a build never sees them, so
// none of their code or demo text reaches a production bundle.
export default (phase: string): NextConfig => {
  const withHeaders: NextConfig = {
    ...config,
    headers: async () => [{ source: '/:path*', headers: securityHeaders(phase) }],
  };
  return phase === PHASE_DEVELOPMENT_SERVER
    ? { ...withHeaders, pageExtensions: ['dev.tsx', 'tsx', 'ts', 'jsx', 'js'] }
    : withHeaders;
};
