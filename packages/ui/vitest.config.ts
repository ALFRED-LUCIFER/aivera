import base from '@credalent/config/vitest';
import { mergeConfig } from 'vitest/config';

// Components render in jsdom for Testing Library (roles, keyboard, focus).
export default mergeConfig(base, { test: { environment: 'jsdom', setupFiles: ['./vitest.setup.ts'] } });
