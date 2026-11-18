import base from '@aivera/config/vitest';
import { mergeConfig } from 'vitest/config';

// The "@/" alias from tsconfig.json; component tests opt into jsdom with a `@vitest-environment jsdom` docblock.
export default mergeConfig(base, { resolve: { alias: { '@': new URL('./src', import.meta.url).pathname } } });
