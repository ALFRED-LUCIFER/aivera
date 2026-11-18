import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// DESIGN.md and AGENTS.md §4: colours come from the Case file tokens. A hex literal or an arbitrary Tailwind value
// (w-[37px], bg-[#fff]) in a component bypasses them; add a theme token in styles.css instead.
const HEX = /#[0-9a-f]{3,8}\b/i;
const ARBITRARY = /[\w:-]+-\[[^\]]*\]/;

function offences(source: string): string[] {
  return [HEX.exec(source)?.[0], ARBITRARY.exec(source)?.[0]].filter((x): x is string => x !== undefined);
}

const src = join(import.meta.dirname, '../src');
const componentFiles = readdirSync(src, { recursive: true, encoding: 'utf8' }).filter(
  (f) => /\.(tsx?|css)$/.test(f) && !/\.test\.tsx?$/.test(f),
);

// SAFETY: mutation check: added text-[#1B1720] to Button.tsx -> the Button.tsx case failed
describe('no hex colour literal or arbitrary value in packages/ui/src', () => {
  it('fires on the fixture that holds both', () => {
    const fixture = readFileSync(join(import.meta.dirname, 'fixtures/HexColour.tsx'), 'utf8');
    expect(offences(fixture)).toEqual(['#1B1720', 'bg-[#1B1720]']);
  });

  it('scans every component file', () => {
    expect(componentFiles).toEqual(expect.arrayContaining(['Button.tsx', 'Dialog.tsx', 'styles.css']));
  });

  it.each(componentFiles)('%s holds none', (file) => {
    expect(offences(readFileSync(join(src, file), 'utf8'))).toEqual([]);
  });
});
