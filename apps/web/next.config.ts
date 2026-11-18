import type { NextConfig } from 'next';

const config: NextConfig = {
  poweredByHeader: false,
  typedRoutes: true,
  // Workspace packages ship TypeScript source (ADR-002).
  transpilePackages: ['@aivera/ui', '@aivera/tokens', '@aivera/i18n'],
};

export default config;
