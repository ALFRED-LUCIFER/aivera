import type { NextConfig } from 'next';
import { PHASE_DEVELOPMENT_SERVER } from 'next/constants';

const config: NextConfig = {
  poweredByHeader: false,
  typedRoutes: true,
  // Workspace packages ship TypeScript source (ADR-002).
  transpilePackages: ['@aivera/ui', '@aivera/tokens', '@aivera/i18n'],
};

// `page.dev.tsx` routes (the /dev/gallery component gallery) exist only under `next dev`: a build never sees them, so
// none of their code or demo text reaches a production bundle.
export default (phase: string): NextConfig =>
  phase === PHASE_DEVELOPMENT_SERVER ? { ...config, pageExtensions: ['dev.tsx', 'tsx', 'ts', 'jsx', 'js'] } : config;
