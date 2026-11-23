import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findUndeclaredEntryPoints } from './entryPoints.ts';

const fixture = join(import.meta.dirname, '..', 'fixtures', 'entry-points');
const repoRoot = join(import.meta.dirname, '..', '..', '..');
const reported = findUndeclaredEntryPoints(fixture).map((v) => `${v.file} ${v.detail}`);
const web = 'apps/web/src';

describe('every server entry point declares its policy or is explicitly public (AGENTS.md 1.3, AIV-P0-907)', () => {
  // SAFETY: mutation check: unwrapped publicEntry from apps/web/src/app/api/health/route.ts -> this test failed (GET named)
  it("today's server actions, route handlers and worker consumers are all declared", () => {
    expect(findUndeclaredEntryPoints(repoRoot)).toEqual([]);
  });

  // SAFETY: mutation check: removed the missing-folder throw -> this test failed
  it('an app folder in the list that does not exist fails the check instead of passing it silently', () => {
    expect(() => findUndeclaredEntryPoints(import.meta.dirname)).toThrow('apps/web/src does not exist');
  });

  it.each([
    [`${web}/features/jobs/services/createJob.ts`, 'createJob'],
    // SAFETY: mutation check: accepted any file importing workspaceAction as declared -> these two cases failed
    [`${web}/app/api/jobs/route.ts`, 'POST'],
    [`${web}/app/api/jobs/route.ts`, 'GET'],
    // SAFETY: mutation check: walked apps/worker instead of apps/backend/worker (ADR-015) -> every worker case failed
    ['apps/backend/worker/src/consumers/assessment.ts', 'handle'],
    [`${web}/features/jobs/services/reexport.ts`, 'makeJob'],
    // SAFETY: mutation check: put getSessionUserId back in GUARDS -> this case failed
    [`${web}/features/signup/services/session.ts`, 'readsSession'],
    // SAFETY: mutation check: declared every export of a file holding a wrapped binding, called or not -> these two cases failed
    // SAFETY: mutation check: counted a publicEntry binding as a guard (problem(...) === null instead of WRAPPERS) -> addViaPublic failed
    [`${web}/features/applicants/services/addApplicants.ts`, 'addApplicantsDirect'],
    [`${web}/features/applicants/services/addApplicants.ts`, 'addViaPublic'],
    // SAFETY: mutation check: dropped the handler's session-read requirement for sessionEntry -> this case failed
    [`${web}/features/signup/services/label.ts`, 'listAll'],
    // SAFETY: mutation check: removed the inline 'use server' branch -> these two cases failed
    [`${web}/app/(recruiter)/app/page.tsx`, 'save'],
    [`${web}/app/(recruiter)/app/jobs/page.tsx`, 'archive'],
    // SAFETY: mutation check: checked destructured names like identifiers again -> this case failed
    [`${web}/app/api/auth/route.ts`, '{ GET, POST }'],
    // SAFETY: mutation check: dropped `name === '*'` from the re-export branch -> this case failed
    [`${web}/app/api/star/route.ts`, '\\*'],
    [`${web}/app/api/legacy/route.js`, 'GET'],
    [`${web}/app/api/mixed/route.ts`, 'GET'],
    // SAFETY: mutation check: removed the raw-receive check -> these cases failed
    ['apps/backend/worker/src/consumers/raw.ts', 'subscribe'],
    ['apps/backend/worker/src/consumers/raw.ts', 'processMessage'],
    ['apps/backend/worker/src/consumers/iterate.ts', 'getMessageIterator'],
    ['apps/backend/worker/src/consumers/iterate.ts', 'processMessage'],
  ])('an undeclared entry point fails and names %s and %s', (file, name) => {
    expect(reported).toContainEqual(
      expect.stringMatching(new RegExp(`^${file.replace(/[.[\]()]/g, '\\$&')} ${name.replace(/[{}]/g, '\\$&')}: `)),
    );
  });

  it('declared entry points pass: workspaceAction, publicEntry or sessionEntry with a reason, a policy guard, the consumer wrapper', () => {
    expect(reported.filter((r) => / (?:createWorkspace|addApplicants):/.test(r))).toEqual([]);
    expect(reported.filter((r) => /declared\.ts|clients\.ts|api\/health\//.test(r))).toEqual([
      // the only one in those files: systemConsumer('') below
      expect.stringContaining('apps/backend/worker/src/consumers/declared.ts systemConsumer('),
    ]);
  });

  // SAFETY: mutation check: accepted any first argument to publicEntry -> this test failed
  it('a public entry point must give its reason', () => {
    expect(reported.filter((r) => r.endsWith('needs a reason'))).toEqual([
      `${web}/app/api/probe/route.ts GET: publicEntry needs a reason`,
      `${web}/app/api/probe/route.ts HEAD: publicEntry needs a reason`,
      `${web}/app/api/probe/route.ts OPTIONS: publicEntry needs a reason`,
      `apps/backend/worker/src/consumers/declared.ts systemConsumer('', async (delivery: Delivery) => delivery.complete()): systemConsumer needs a reason`,
    ]);
  });

  it('exports of a route file other than HTTP methods, and type exports, are not entry points', () => {
    expect(reported.filter((r) => / (?:dynamic|revalidate|CreateJobState):/.test(r))).toEqual([]);
  });
});
