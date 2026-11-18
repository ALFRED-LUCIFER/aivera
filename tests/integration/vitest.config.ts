import { defineConfig, mergeConfig } from 'vitest/config';
import base from '@aivera/config/vitest';

// Starting a PostgreSQL container takes longer than a unit test.
export default mergeConfig(base, defineConfig({ test: { hookTimeout: 180_000, testTimeout: 60_000 } }));
