import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

export type Theme = 'light' | 'dark';

export const tokens = createRequire(import.meta.url)('@aivera/tokens/tokens.json') as {
  color: Record<Theme, Record<string, string>>;
  radius: Record<string, string>;
  control: Record<string, string>;
  motion: Record<string, string>;
};

export const stylesCss = readFileSync(join(import.meta.dirname, '../src/styles.css'), 'utf8');

/** The tokens.json colour a Tailwind colour utility (bg-action, text-on-action) resolves to, through styles.css. */
export function resolveColour(utility: string, theme: Theme): string | undefined {
  const name = utility.replace(/^(bg|text|border|outline)-/, '');
  const token = new RegExp(`--color-${name}:\\s*var\\(--([\\w-]+)\\);`).exec(stylesCss)?.[1];
  return token === undefined ? undefined : tokens.color[theme][token];
}

function luminance(hex: string): number {
  const [r = 0, g = 0, b = 0] = [1, 3, 5].map((i) => {
    const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.040_45 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.2 contrast ratio of two #RRGGBB colours. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].toSorted((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}
