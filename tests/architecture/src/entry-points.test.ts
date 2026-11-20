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

  it.each([
    [`${web}/features/jobs/services/createJob.ts`, 'createJob'],
    // SAFETY: mutation check: accepted any file importing workspaceAction as declared -> these two cases failed
    [`${web}/app/api/jobs/route.ts`, 'POST'],
    [`${web}/app/api/jobs/route.ts`, 'GET'],
    ['apps/worker/src/consumers/assessment.ts', 'handle'],
    [`${web}/features/jobs/services/reexport.ts`, 'makeJob'],
  ])('an undeclared entry point fails and names %s and %s', (file, name) => {
    expect(reported).toContainEqual(expect.stringMatching(new RegExp(`^${file.replace(/[.[\]]/g, '\\$&')} ${name}: `)));
  });

  it('declared entry points pass: workspaceAction, publicEntry with a reason, a policy guard, the consumer wrapper', () => {
    expect(reported.filter((r) => /declared\.ts|clients\.ts|api\/health\//.test(r))).toEqual([
      // the only one in those files: systemConsumer('') below
      expect.stringContaining('apps/worker/src/consumers/declared.ts systemConsumer('),
    ]);
  });

  // SAFETY: mutation check: accepted any first argument to publicEntry -> this test failed
  it('a public entry point must give its reason', () => {
    expect(reported.filter((r) => r.endsWith('needs a reason'))).toEqual([
      `${web}/app/api/probe/route.ts GET: publicEntry needs a reason`,
      `${web}/app/api/probe/route.ts HEAD: publicEntry needs a reason`,
      `${web}/app/api/probe/route.ts OPTIONS: publicEntry needs a reason`,
      `apps/worker/src/consumers/declared.ts systemConsumer('', async (delivery: Delivery) => delivery.complete()): systemConsumer needs a reason`,
    ]);
  });

  it('exports of a route file other than HTTP methods, and type exports, are not entry points', () => {
    expect(reported.filter((r) => / (?:dynamic|revalidate|CreateJobState):/.test(r))).toEqual([]);
  });
});
