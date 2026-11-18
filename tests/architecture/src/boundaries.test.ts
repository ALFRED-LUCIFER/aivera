import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findViolations } from './rules.ts';

const fixture = (name: string) => join(import.meta.dirname, '..', 'fixtures', name);
const repoRoot = join(import.meta.dirname, '..', '..', '..');

describe('architecture boundaries (ADR-002, AGENTS.md 1.8 and 9)', () => {
  it('the repository has no violations', () => {
    expect(findViolations(repoRoot)).toEqual([]);
  });

  it('a clean layout passes: contracts imports, composition from an app, a package using tokens', () => {
    expect(findViolations(fixture('clean'))).toEqual([]);
  });

  // SAFETY: mutation check: made findViolations return [] -> every case below failed
  it.each([
    ['deep-import', 'module-contracts-only', 'modules/evidence/src/application/x.ts'],
    ['composition-from-module', 'composition-apps-only', 'modules/evidence/src/application/x.ts'],
    ['relative-cross', 'relative-crosses-unit', 'modules/evidence/src/application/x.ts'],
    ['package-imports-app', 'package-imports-app', 'packages/ui/src/x.ts'],
    ['module-no-ui', 'module-no-ui', 'modules/jobs/src/application/x.ts'],
    ['paid-ranking', 'paying-never-changes-ranking', 'modules/assessment/src/application/rank.ts'],
    ['components-tsx', 'components-tsx-only', 'apps/web/src/features/jobs/components/sortJobs.ts'],
  ])('%s is reported as %s and names the file', (name, rule, file) => {
    expect(findViolations(fixture(name))).toContainEqual(expect.objectContaining({ rule, file }));
  });
});
