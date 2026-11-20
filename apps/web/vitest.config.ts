import base from '@credalent/config/vitest';
import { mergeConfig } from 'vitest/config';

// The "@/" alias from tsconfig.json; component tests opt into jsdom with a `@vitest-environment jsdom` docblock.
// next-auth imports `next/server` without an extension, which Node's ESM loader refuses; Vite resolves it when inlined.
export default mergeConfig(base, {
  resolve: { alias: { '@': new URL('./src', import.meta.url).pathname } },
  test: { server: { deps: { inline: ['next-auth'] } } },
});
