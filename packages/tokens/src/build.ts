import { writeFileSync } from 'node:fs';
import { toCss } from './toCss.ts';

writeFileSync(new URL('../tokens.css', import.meta.url), toCss());
