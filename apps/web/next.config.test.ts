import { PHASE_DEVELOPMENT_SERVER, PHASE_PRODUCTION_BUILD, PHASE_PRODUCTION_SERVER } from 'next/constants';
import { describe, expect, it } from 'vitest';
import config from './next.config.ts';

describe('Scenario: The gallery is not shipped to production', () => {
  it('only next dev routes page.dev.tsx files', () => {
    expect(config(PHASE_DEVELOPMENT_SERVER).pageExtensions).toContain('dev.tsx');
  });

  // SAFETY: mutation check: added 'dev.tsx' to pageExtensions in every phase -> this test failed
  it.each([PHASE_PRODUCTION_BUILD, PHASE_PRODUCTION_SERVER])('%s never sees page.dev.tsx', (phase) => {
    expect(config(phase).pageExtensions ?? ['tsx', 'ts', 'jsx', 'js']).not.toContain('dev.tsx');
  });
});
