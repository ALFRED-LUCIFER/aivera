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

  // AIV-P2-037: the operator-only workspace changes are called from server/operator.ts and nowhere else in an app.
  // SAFETY: mutation check: removed the operator-only-writes check -> this test failed
  it('a call to changeStatus, pausePublicListings or setApprovalRequired outside server/operator.ts is reported', () => {
    expect(
      findViolations(fixture('operator-writes'))
        .filter((v) => v.rule === 'operator-only-writes')
        .map((v) => v.file),
    ).toEqual(['apps/web/src/features/jobs/services/x.ts', 'apps/web/src/features/signup/services/y.ts']);
  });

  // AIV-P2-053 (ADR-012 point 8): only console code reads the platform audit log.
  // SAFETY: mutation check: removed the platform-audit-read-console-only check -> this test failed
  // SAFETY: mutation check: allowed every apps file (dropped the OPS_READ_AREA test) -> this test failed (features/jobs missing)
  it('a call to listPlatformEntries outside app/(ops), features/ops*, server/ops*, server/operator.ts or modules/ops is reported', () => {
    expect(
      findViolations(fixture('platform-audit-read'))
        .filter((v) => v.rule === 'platform-audit-read-console-only')
        .map((v) => v.file)
        .toSorted(),
    ).toEqual(['apps/web/src/features/jobs/services/x.ts', 'modules/jobs/src/application/x.ts']);
  });

  // SAFETY: mutation check: removed the no-code-catalogue check -> this test failed
  it('AIV-P2-044: a file naming a code catalogue constant (JOB_TYPES, DOMAIN_KEYS, a version constant) is reported', () => {
    expect(
      findViolations(fixture('code-catalogue'))
        .filter((v) => v.rule === 'no-code-catalogue')
        .map((v) => v.file)
        .toSorted(),
    ).toEqual(['apps/web/src/features/jobs/domain/x.ts', 'modules/jobs/src/domain/y.ts']);
  });

  // SAFETY: mutation check: removed the job-owner-from-jobs check -> this test failed
  it('a call to setJobOwner outside the jobs module is reported (AIV-P1-056)', () => {
    expect(
      findViolations(fixture('job-owner'))
        .filter((v) => v.rule === 'job-owner-from-jobs')
        .map((v) => v.file),
    ).toEqual(['apps/web/src/features/jobs/services/x.ts']);
  });

  // SAFETY: mutation check: removed the recruiter-app-no-candidate-data check -> this test failed
  it('only the candidate site, its server readers and the wiring roots import candidate accounts or sessions', () => {
    expect(
      findViolations(fixture('candidate-data'))
        .filter((v) => v.rule === 'recruiter-app-no-candidate-data')
        .map((v) => v.file)
        .toSorted(),
    ).toEqual([
      'apps/web/src/app/(recruiter)/app/page.tsx',
      'apps/web/src/features/shell/domain/y.ts',
      'apps/web/src/features/shell/proxy.ts',
      'apps/web/src/features/shell/services/x.ts',
    ]);
  });

  // AIV-P2-036 (ADR-012 point 6): the console reads metadata through allowed contracts only, never the pool.
  // SAFETY: mutation check: removed the ops-metadata-contracts-only check -> this test failed
  // SAFETY: mutation check: added 'candidates' to OPS_CONTRACTS -> this test failed (features/ops/services/x.ts missing)
  // SAFETY: mutation check: allowed every app server file (only server/db refused) -> this test failed (@/server/workspace missing)
  it('console code importing a candidate-bearing module, a composition root, the pool or app server code other than operator.ts is reported', () => {
    expect(
      findViolations(fixture('ops-reads'))
        .filter((v) => v.rule === 'ops-metadata-contracts-only')
        .map((v) => `${v.file} ${v.detail.split(':')[0]}`)
        .toSorted(),
    ).toEqual([
      'apps/web/src/app/(ops)/ops/workspaces/page.tsx ../../../../server/db',
      'apps/web/src/features/ops/services/x.ts @/server/db',
      'apps/web/src/features/ops/services/x.ts @/server/workspace',
      'apps/web/src/features/ops/services/x.ts @credalent/candidates',
      'apps/web/src/server/opsReads.ts @credalent/db/client',
      'apps/web/src/server/opsReads.ts @credalent/workspaces/composition',
    ]);
  });

  // SAFETY: mutation check: scope pattern back to the old @aivera/ prefix -> this test failed
  it('a public API route importing a module other than jobs, or app server code, is reported for each import', () => {
    expect(
      findViolations(fixture('public-api'))
        .filter((v) => v.rule === 'public-api-jobs-only')
        .map((v) => v.detail.split(':')[0])
        .toSorted(),
    ).toEqual(['@/server/db', '@credalent/candidates/composition']);
  });

  // SAFETY: mutation check: made findViolations return [] -> every case below failed
  it.each([
    ['deep-import', 'module-contracts-only', 'modules/evidence/src/application/x.ts'],
    ['composition-from-module', 'composition-apps-only', 'modules/evidence/src/application/x.ts'],
    ['relative-cross', 'relative-crosses-unit', 'modules/evidence/src/application/x.ts'],
    // AIV-P1-024: no module reads the evidence module's infrastructure, by package path or relative path.
    ['evidence-infrastructure', 'module-contracts-only', 'modules/assessment/src/application/x.ts'],
    ['evidence-infrastructure', 'relative-crosses-unit', 'modules/assessment/src/application/y.ts'],
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
