import { defineConfig, mergeConfig } from 'vitest/config';
import base from '@credalent/config/vitest';

// The eval tests score the whole recorded golden set; in CI they share one runner with every other package's tests and
// have passed 5 s there (main, 25 Nov 2026). A hung test still fails, just later.
export default mergeConfig(base, defineConfig({ test: { testTimeout: 30_000 } }));
