import { PHASE_DEVELOPMENT_SERVER, PHASE_PRODUCTION_BUILD, PHASE_PRODUCTION_SERVER } from 'next/constants';
import { describe, expect, it } from 'vitest';
import config, { securityHeaders } from './next.config.ts';

describe('Scenario: The gallery is not shipped to production', () => {
  it('only next dev routes page.dev.tsx files', () => {
    expect(config(PHASE_DEVELOPMENT_SERVER).pageExtensions).toContain('dev.tsx');
  });

  // SAFETY: mutation check: added 'dev.tsx' to pageExtensions in every phase -> this test failed
  it.each([PHASE_PRODUCTION_BUILD, PHASE_PRODUCTION_SERVER])('%s never sees page.dev.tsx', (phase) => {
    expect(config(phase).pageExtensions ?? ['tsx', 'ts', 'jsx', 'js']).not.toContain('dev.tsx');
  });
});

const value = (phase: string, key: string) => securityHeaders(phase).find((h) => h.key === key)?.value;

describe('Scenario: Every page is served with security headers (AIV-P1-092)', () => {
  // SAFETY: mutation check: removed frame-ancestors 'none' from the policy -> this test failed
  it.each([PHASE_DEVELOPMENT_SERVER, PHASE_PRODUCTION_BUILD, PHASE_PRODUCTION_SERVER])(
    '%s: refuses framing, sniffing and referrers',
    (phase) => {
      expect(value(phase, 'Content-Security-Policy')).toContain("frame-ancestors 'none'");
      expect(value(phase, 'Content-Security-Policy')).toContain("object-src 'none'");
      expect(value(phase, 'X-Content-Type-Options')).toBe('nosniff');
      expect(value(phase, 'Referrer-Policy')).toBe('strict-origin-when-cross-origin');
    },
  );

  it('applies to every route through next.config headers()', async () => {
    expect(await config(PHASE_PRODUCTION_BUILD).headers?.()).toEqual([
      { source: '/:path*', headers: securityHeaders(PHASE_PRODUCTION_BUILD) },
    ]);
  });

  it('sets HSTS in production only, and eval and localhost only in dev', () => {
    expect(value(PHASE_PRODUCTION_SERVER, 'Strict-Transport-Security')).toBe('max-age=31536000; includeSubDomains');
    expect(value(PHASE_DEVELOPMENT_SERVER, 'Strict-Transport-Security')).toBeUndefined();
    expect(value(PHASE_PRODUCTION_SERVER, 'Content-Security-Policy')).not.toMatch(/unsafe-eval|localhost/);
    expect(value(PHASE_DEVELOPMENT_SERVER, 'Content-Security-Policy')).toContain('unsafe-eval');
  });
});
