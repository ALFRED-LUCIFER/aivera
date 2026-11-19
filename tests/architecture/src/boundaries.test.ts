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

  it('a candidate-side module may import candidate-accounts; only the recruiter-side importers are reported', () => {
    expect(findViolations(fixture('candidate-accounts')).map((v) => v.file)).toEqual([
      'modules/pool/src/domain/x.ts',
      'modules/workspaces/src/application/x.ts',
    ]);
  });

  // AIV-P2-035 (ADR-012): every /ops entry point declares the platformOperator policy.
  // SAFETY: mutation check: removed the ops-platform-operator-policy check -> this test failed
  // SAFETY: mutation check: tested the whole file for the policy instead of each exported function -> this test failed (page.tsx, x.ts missing)
  it('an /ops page, metadata, route handler or server action without `await platformOperator()` is reported', () => {
    expect(
      findViolations(fixture('ops-policy'))
        .filter((v) => v.rule === 'ops-platform-operator-policy')
        .map((v) => v.file)
        .toSorted(),
    ).toEqual([
      'apps/web/src/app/(ops)/ops/page.tsx',
      'apps/web/src/app/(ops)/ops/workspaces/route.ts',
      'apps/web/src/features/ops/services/x.ts',
    ]);
  });

  // SAFETY: mutation check: removed the recruiter-app-no-candidate-data check -> this test failed
  it('only the candidate site, its server readers and the wiring roots import candidate accounts or sessions', () => {
    expect(
      findViolations(fixture('candidate-data'))
        .filter((v) => v.rule === 'recruiter-app-no-candidate-data')
        .map((v) => v.file),
    ).toEqual([
      'apps/web/src/app/(recruiter)/app/page.tsx',
      'apps/web/src/features/shell/domain/y.ts',
      'apps/web/src/features/shell/services/x.ts',
    ]);
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
    ['raw-pool', 'scoped-tx-only', 'modules/jobs/src/infrastructure/repository.ts'],
    // SAFETY: mutation check: removed the candidate-site-no-recruiter-session check -> this case failed
    // SAFETY: mutation check: removed the public-api-jobs-only check -> this case failed
    ['public-api', 'public-api-jobs-only', 'apps/web/src/app/api/public/jobs/route.ts'],
    ['candidate-session', 'candidate-site-no-recruiter-session', 'apps/web/src/app/(candidate)/layout.tsx'],
    // SAFETY: mutation check: tested the raw spec instead of the resolved relative path -> this case failed
    ['candidate-session', 'candidate-site-no-recruiter-session', 'apps/web/src/features/candidate-shell/domain/x.ts'],
    // SAFETY: mutation check: removed the recruiter-side-no-candidate-accounts check -> these cases failed
    ['candidate-accounts', 'recruiter-side-no-candidate-accounts', 'modules/workspaces/src/application/x.ts'],
    ['candidate-accounts', 'recruiter-side-no-candidate-accounts', 'modules/pool/src/domain/x.ts'],
    ['ai-sdk-direct', 'ai-sdk-only-in-packages-ai', 'modules/jobs/src/application/x.ts'],
  ])('%s is reported as %s and names the file', (name, rule, file) => {
    expect(findViolations(fixture(name))).toContainEqual(expect.objectContaining({ rule, file }));
  });
});
