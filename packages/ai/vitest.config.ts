import { defineConfig, mergeConfig } from 'vitest/config';
import base from '@credalent/config/vitest';

// The eval tests score the whole recorded golden set, and in CI have run past Vitest's 5 s default (main, 25 Nov 2026).
// shortcut: raises only this package's timeout while CI runs every package's tests at once on one runner; limit turbo's
// test concurrency in CI or give tests/integration its own job when another package times out the same way.
export default mergeConfig(base, defineConfig({ test: { testTimeout: 30_000 } }));
