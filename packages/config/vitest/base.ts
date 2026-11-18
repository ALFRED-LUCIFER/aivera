import { defineConfig } from 'vitest/config';

// Shared Vitest base (ADR-002): every package's vitest.config.ts merges this.
export default defineConfig({
  test: {
    include: ['**/*.test.{ts,tsx}'],
    exclude: ['**/node_modules/**', '**/fixtures/**', '**/.next/**'],
  },
});
