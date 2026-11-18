import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import tokens from './tokens.json' with { type: 'json' };
import { toCss } from './toCss.ts';

describe('Case file tokens', () => {
  it('the committed tokens.css matches tokens.json (run pnpm --filter @aivera/tokens build)', () => {
    expect(readFileSync(new URL('../tokens.css', import.meta.url), 'utf8')).toBe(toCss());
  });

  it('light and dark define exactly the same colour tokens', () => {
    expect(Object.keys(tokens.color.dark)).toEqual(Object.keys(tokens.color.light));
  });

  it('dark tokens apply under data-theme="dark"', () => {
    const dark = toCss().split('[data-theme="dark"] {')[1] ?? '';
    expect(dark).toContain('--bg: #141118;');
    expect(dark).toContain('--hl: #4D4208;');
    expect(dark).toContain('--focus: #FFE873;');
  });

  it('matches the Foundations artboard values that carry meaning', () => {
    expect(tokens.color.light.hl).toBe('#FFE873'); // the highlighter, cited evidence only
    expect(tokens.color.light.text).toBe('#1B1720');
    expect(tokens.radius).toEqual({ tag: '6px', control: '8px', card: '12px' });
    expect(tokens.control).toEqual({ compact: '36px', standard: '40px', touch: '44px' });
  });
});
