import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

const configDir = dirname(import.meta.dirname);
const oxlintBin = join(dirname(createRequire(import.meta.url).resolve('oxlint/package.json')), 'bin', 'oxlint');

type Diagnostic = { filename: string; code: string; labels: { span: { line: number } }[] };

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
    byFile.set(file, [...(byFile.get(file) ?? []), d.code, `${d.code} at line ${d.labels[0]?.span.line}`]);
  }
  return byFile;
}

// ADR-003: each layer rule fires on the fixture that breaks it, and a clean component passes.
// SAFETY: mutation check: removed the components/ override from web.json -> the components/* cases failed
// SAFETY: mutation check: removed restrictedAttributes from jsx-no-literals -> the HardCodedLabel.tsx case failed
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
    // AIV-P0-026: hard-coded copy anywhere in a web app or packages/ui, as JSX text or in aria-label, title, placeholder.
    ['test/fixtures/web/src/app/HardCoded.tsx', 'react(jsx-no-literals) at line 3'],
    ['test/fixtures/web/src/app/HardCodedLabel.tsx', 'react(jsx-no-literals) at line 3'], // aria-label
    ['test/fixtures/web/src/app/HardCodedLabel.tsx', 'react(jsx-no-literals) at line 4'], // placeholder
    ['test/fixtures/web/src/app/HardCodedLabel.tsx', 'react(jsx-no-literals) at line 5'], // title
  ])('%s is reported with %s', (file, code) => {
    expect(found.get(file)).toContain(code);
  });

  it.each([
    ['a presentational component using only domain types and props', 'alpha/components/Good.tsx'],
    ['the same copy through t("evidence.request.send")', 'test/fixtures/web/src/app/Translated.tsx'],
    ['literal text in a test file', 'test/fixtures/web/src/app/HardCoded.test.tsx'],
  ])('%s passes', (_, file) => {
    expect(found.get(file)).toBeUndefined();
  });
});
