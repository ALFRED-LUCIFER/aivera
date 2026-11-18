import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// DESIGN.md and AGENTS.md §4: colours and sizes come from the Case file tokens. A colour literal or an arbitrary
// Tailwind value in a component bypasses them; add a theme token in styles.css instead.
const RULES: Record<string, RegExp> = {
  hex: /#[0-9a-f]{3,8}\b/i,
  colourFunction: /\b(rgba?|hsla?|oklch|oklab|lab|lch|hwb|color-mix)\(/i,
  arbitraryValue: /[\w:-]+-\[[^\]]*\]/, // w-[37px], bg-[#fff], has-[...]
  arbitraryProperty: /\[[a-z-]+:[^\]\s]+\]/, // [color:red]
  variableShorthand: /[\w:-]+-\(--[\w-]+\)/, // Tailwind 4 bg-(--brand)
};

const offences = (source: string) => Object.keys(RULES).filter((rule) => RULES[rule]?.test(source));

const src = join(import.meta.dirname, '../src');
const componentFiles = readdirSync(src, { recursive: true, encoding: 'utf8' }).filter(
  (f) => /\.(tsx?|css)$/.test(f) && !/\.test\.tsx?$/.test(f),
);

// SAFETY: mutation check: added text-[#1B1720] to Button.tsx -> the Button.tsx case failed
describe('no colour literal or arbitrary value in packages/ui/src', () => {
  it.each([
    ['HexColour.tsx', ['hex', 'arbitraryValue']],
    ['ColourFunctions.tsx', ['colourFunction']],
    ['ArbitraryProperty.tsx', ['arbitraryProperty']],
    ['VariableShorthand.tsx', ['variableShorthand']],
  ])('fires on the fixture %s', (fixture, expected) => {
    expect(offences(readFileSync(join(import.meta.dirname, 'fixtures', fixture), 'utf8'))).toEqual(expected);
  });

  it('scans every component file', () => {
    expect(componentFiles).toEqual(expect.arrayContaining(['Button.tsx', 'Dialog.tsx', 'styles.css']));
  });

  it.each(componentFiles)('%s holds none', (file) => {
    expect(offences(readFileSync(join(src, file), 'utf8'))).toEqual([]);
  });
});
