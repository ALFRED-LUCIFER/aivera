import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

const configDir = dirname(import.meta.dirname);
const oxlintBin = join(dirname(createRequire(import.meta.url).resolve('oxlint/package.json')), 'bin', 'oxlint');

type Diagnostic = { filename: string; code: string };

function lintFixtures(): Map<string, string[]> {
  let out: string;
  try {
    out = execFileSync(oxlintBin, ['-c', 'oxlint/web.json', '--format', 'json', 'test/fixtures'], {
      cwd: configDir,
      encoding: 'utf8',
    });
  } catch (error) {
    out = (error as { stdout: string }).stdout; // oxlint exits 1 when it finds errors, which these fixtures exist to produce
  }
  const byFile = new Map<string, string[]>();
  for (const d of (JSON.parse(out) as { diagnostics: Diagnostic[] }).diagnostics) {
    const file = d.filename.split('features/')[1] ?? d.filename;
    byFile.set(file, [...(byFile.get(file) ?? []), d.code]);
  }
  return byFile;
}

// ADR-003: each layer rule fires on the fixture that breaks it, and a clean component passes.
// SAFETY: mutation check: removed the components/ override from web.json -> the components/* cases failed
describe('web layer lint rules', () => {
  const found = lintFixtures();

  it.each([
    ['alpha/components/ImportsHook.tsx', 'eslint(no-restricted-imports)'],
    ['alpha/components/ImportsQuery.tsx', 'eslint(no-restricted-imports)'],
    ['alpha/components/CallsFetch.tsx', 'eslint(no-restricted-globals)'],
    ['alpha/components/UsesStorage.tsx', 'eslint(no-restricted-properties)'],
    ['alpha/components/Literal.tsx', 'react(jsx-no-literals)'],
    ['alpha/components/CrossFeature.tsx', 'eslint(no-restricted-imports)'],
    ['alpha/domain/ImportsReact.ts', 'eslint(no-restricted-imports)'],
    ['alpha/hooks/useAlphaController.ts', 'eslint(no-restricted-imports)'],
    ['alpha/services/ImportsReact.ts', 'eslint(no-restricted-imports)'],
  ])('%s is reported with %s', (file, code) => {
    expect(found.get(file)).toContain(code);
  });

  it('a presentational component using only domain types and props passes', () => {
    expect(found.get('alpha/components/Good.tsx')).toBeUndefined();
  });
});
