import { globSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { activeScreen, canOpen, navigation } from './navigation.ts';
import { parseTheme } from './shell.ts';

const appDir = new URL('../../../app/', import.meta.url).pathname;

// "(recruiter)/app/inbox/page.tsx" -> "/app/inbox": route groups do not appear in the URL.
const pages = globSync('**/page.tsx', { cwd: appDir }).map((file) => ({
  file,
  path: `/${dirname(file)
    .split('/')
    .filter((segment) => segment !== '.' && !/^\(.*\)$/.test(segment))
    .join('/')}`,
}));
/** The candidate profile for a job: guarded by the job scope, not by a section's entry (see its test below). */
const PROFILE = 'candidates/[candidateId]';
const appPages = pages.filter(({ path }) => path === '/app' || path.startsWith('/app/'));

describe('navigation map (ADR-002 item 4)', () => {
  // SAFETY: mutation check: deleted app/(recruiter)/app/pool/page.tsx -> "every map entry has a page" failed
  it('every map entry has a page', () => {
    const routed = new Set(pages.map(({ path }) => path));
    expect(navigation.filter(({ path }) => !routed.has(path)).map(({ path }) => path)).toEqual([]);
  });

  // SAFETY: mutation check: removed the value entry from navigation -> "every section page under /app (/app/<section>) has a map entry" failed
  it('every section page under /app (/app/<section>) has a map entry', () => {
    const mapped = new Set<string>(navigation.map(({ path }) => path));
    const sections = appPages.filter(({ path }) => path.split('/').length <= 3);
    expect(sections.filter(({ path }) => !mapped.has(path)).map(({ file }) => file)).toEqual([]);
  });

  // SAFETY: mutation check: inbox page passed screen="jobs" -> this test failed
  // A page inside a section (/app/jobs/new) guards itself with its section's entry.
  it('every page under /app guards itself with its own map entry', () => {
    for (const { file, path } of appPages.filter(
      (page) => !page.file.includes('/(job)/[jobId]/') && !page.file.includes(PROFILE),
    )) {
      const id = activeScreen(path) ?? '?';
      const source = readFileSync(join(appDir, file), 'utf8');
      expect(source, file).toMatch(new RegExp(`(screen=|requireScreen\\()["']${id}["']`));
    }
  });

  // SAFETY: mutation check: removed loadJob from the job layout -> this test failed
  // A job's pages are open to its granted hiring owners and interviewers too (AIV-P1-012), so they have no screen entry:
  // the job layout refuses a job the member cannot view (job.view), before any of them renders.
  it("every job page sits under the job layout, which loads the job through the member's job scope", () => {
    const jobPages = appPages.filter(({ file }) => file.includes('/(job)/[jobId]/'));
    expect(jobPages.length).toBeGreaterThan(0);
    const layout = jobPages[0]?.file.replace(/\[jobId\]\/.*$/, '[jobId]/layout.tsx') ?? '';
    const source = readFileSync(join(appDir, layout), 'utf8');
    expect(source).toMatch(/await loadJob\(/);
    expect(source).toMatch(/notFound\(\)/);
  });

  // SAFETY: mutation check: removed `if (profile === 'forbidden') forbidden();` from the profile page -> this test failed
  // A candidate's profile for a job (AIV-P1-043) is open to that job's granted hiring owners and interviewers too, so it
  // has no screen entry either: loadProfile decides through the member's job scope, and the page renders its refusals.
  it("the candidate profile page loads through the member's job scope and renders 403 and 404", () => {
    const source = readFileSync(join(appDir, '(recruiter)/app', PROFILE, 'page.tsx'), 'utf8');
    expect(source).toMatch(/await loadProfile\(/);
    expect(source).toMatch(/=== 'forbidden'\) forbidden\(\)/);
    expect(source).toMatch(/=== 'notFound'\) notFound\(\)/);
  });

  it('marks the section a path belongs to, the longest match winning', () => {
    expect(activeScreen('/app')).toBe('desk');
    expect(activeScreen('/app/jobs')).toBe('jobs');
    expect(activeScreen('/app/jobs/123/pack')).toBe('jobs');
    expect(activeScreen('/app/candidates/abc')).toBe('candidates');
    expect(activeScreen('/app/jobsboard')).toBe('desk');
    expect(activeScreen('/')).toBeUndefined();
  });

  it('opens a screen only with its capability and, when it has one, its flag', () => {
    const flagged = { ...navigation[0], flag: 'beta' };
    expect(canOpen(navigation[0], ['member', 'recruiter'], new Set())).toBe(true);
    expect(canOpen(navigation[0], [], new Set())).toBe(false);
    // Hiring owners and interviewers hold `member` only: the desk and jobs, nothing else (AIV-P1-091).
    const opened = navigation
      .filter((entry) => canOpen(entry, ['member'], new Set(['inbox', 'candidates'])))
      .map((e) => e.id);
    expect(opened).toEqual(['desk', 'jobs']);
    expect(canOpen(flagged, ['member', 'recruiter'], new Set())).toBe(false);
    expect(canOpen(flagged, ['member', 'recruiter'], new Set(['beta']))).toBe(true);
  });
});

const ids = (flags: string[]) =>
  navigation.filter((entry) => canOpen(entry, ['member', 'recruiter'], new Set(flags))).map(({ id }) => id);

describe('unbuilt sections (AIV-P1-095)', () => {
  it('stay out of the sidebar until their flag is on', () => {
    expect(ids([])).toEqual(['desk', 'jobs', 'settings']);
    expect(ids(['pool'])).toEqual(['desk', 'jobs', 'pool', 'settings']);
  });

  // The route half (404 while off, opens when on) is tested against requireScreen in services/request.test.ts.
  it('every unbuilt section page guards itself with its own entry', () => {
    for (const id of ['inbox', 'candidates', 'pool', 'interviews', 'packs', 'value']) {
      const source = readFileSync(join(appDir, '(recruiter)/app', id, 'page.tsx'), 'utf8');
      expect(source, id).toContain(`screen="${id}"`);
    }
  });
});

describe('parseTheme', () => {
  it('accepts dark and turns anything else into light', () => {
    expect(parseTheme('dark')).toBe('dark');
    expect(parseTheme('light')).toBe('light');
    expect(parseTheme('"><script>')).toBe('light');
    expect(parseTheme(undefined)).toBe('light');
  });
});
