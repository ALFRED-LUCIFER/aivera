import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { NextConfig } from 'next';
import { PHASE_DEVELOPMENT_SERVER } from 'next/constants';

// Local development keeps one .env.local at the repository root (runbook); Next.js only reads apps/web by itself.
const rootEnv = join(import.meta.dirname, '..', '..', '.env.local');
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const config: NextConfig = {
  // Set only by the e2e configs (tests/e2e): the second `next dev` (no candidate sign-in) and the production build each need their own folder.
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
    '@credalent/assessment',
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
 * build (`next start` reads routes-manifest.json) while the Blob and tenant settings arrive at run time. `form-action`
 * lists the sign-in hosts because browsers apply it to the redirect after a form post (Auth.js sign-in); a custom
 * External ID domain would need its host added here. `next dev` needs eval for HMR and the mocked sign-in hosts on
 * localhost. X-Frame-Options DENY stays beside frame-ancestors for browsers that ignore CSP.
 */
export function securityHeaders(phase: string): Header[] {
  const dev = phase === PHASE_DEVELOPMENT_SERVER;
  const csp = [
    "default-src 'self'",
    // shortcut: 'unsafe-inline' scripts, because Next.js inlines its hydration payload and a nonce needs the CSP set in
    // proxy.ts, whose matcher (/app, /ops, /candidates/me) would widen to every route; upgrade to a proxy nonce with
    // 'strict-dynamic' when XSS hardening outranks that change (pages are already dynamic: the layout reads a cookie).
    `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ''}`,
    // shortcut: 'unsafe-inline' styles, because Tailwind, Radix and next/font set inline style attributes; upgrade
    // together with the script nonce, or by moving those to classes.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    // The browser uploads straight to Blob storage with a signed URL (AIV-P0-016).
    // shortcut: any storage account; narrow to AZURE_STORAGE_BLOB_URL's account when the CSP moves to the proxy.
    "connect-src 'self' https://*.blob.core.windows.net",
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
    // Not in dev: it is served over http, and browsers would pin http://localhost to https for a year.
    ...(dev ? [] : [{ key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' }]),
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
