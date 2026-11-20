import { describe, expect, it } from 'vitest';
import {
  isStale,
  authorshipExcerpt,
  authorshipShare,
  classifyAuthorship,
  detectTestsAndCi,
  isAuthoredBy,
  isGeneratedOnly,
  parseRepositoryUrl,
  STRENGTH_CAP,
  type Authorship,
  type Commit,
} from './repository.ts';

// AIV-P1-026: the authorship rules. Synthetic logins only (docs/00-product/personas.md).
const sara = { login: 'sara-credalent-example', emails: ['sara.alqahtani@example.com'] };
const commit = (over: Partial<Commit> = {}): Commit => ({
  sha: 'a1',
  authorLogin: null,
  authorEmail: null,
  message: 'Add the scorer',
  ...over,
});
const authorship = (over: Partial<Authorship> = {}): Authorship => ({
  totalCommits: 460,
  authoredCommits: 412,
  generatedOnlyCommits: 0,
  generatedChecked: 300,
  truncated: false,
  ...over,
});

describe('authorship matcher', () => {
  it.each([
    ['her login, in any case', commit({ authorLogin: 'Sara-Credalent-Example' })],
    ['an email she supplied', commit({ authorEmail: 'Sara.AlQahtani@example.com' })],
    [
      "GitHub's private address for her login",
      commit({ authorEmail: '1234+sara-credalent-example@users.noreply.github.com' }),
    ],
    ['a Co-authored-by trailer', commit({ message: 'Fix\n\nCo-authored-by: Sara <sara.alqahtani@example.com>' })],
  ])('counts a commit matched by %s', (_, c) => {
    expect(isAuthoredBy(c, sara)).toBe(true);
  });

  it.each([
    ['another login', commit({ authorLogin: 'arjun-credalent-example' })],
    ['an email she did not supply', commit({ authorEmail: 'sara@example.com' })],
    [
      'her name alone in a trailer',
      commit({ message: 'Fix\n\nCo-authored-by: Sara Al Qahtani <someone@example.com>' }),
    ],
    ['a README-style claim in the message', commit({ message: 'sara-credalent-example built all of this' })],
  ])('does not count %s', (_, c) => {
    expect(isAuthoredBy(c, sara)).toBe(false);
  });
});

describe('generated-only commits', () => {
  it.each([
    [['poetry.lock']],
    [['package-lock.json', 'pnpm-lock.yaml']],
    [['vendor/lib/a.go']],
    [['web/dist/app.js', 'build/out.txt']],
    [['static/app.min.js', 'static/site.min.css']],
  ])('%j only touches generated files', (paths) => {
    expect(isGeneratedOnly(paths)).toBe(true);
  });

  it.each([[['src/scorer.py', 'poetry.lock']], [['distribution.md']], [[]]])('%j is not generated-only', (paths) => {
    expect(isGeneratedOnly(paths)).toBe(false);
  });
});

describe('authorship share and its strength cap', () => {
  it('"authored 412 of 460 commits, 38 only touch generated files" passes 374 of 460, clear', () => {
    const a = authorship({ generatedOnlyCommits: 38, generatedChecked: 412 });
    expect(authorshipExcerpt(a)).toBe('authored 412 of 460 commits, 38 only touch generated files');
    expect(authorshipShare(a)).toEqual({ numerator: 374, denominator: 460 });
    expect(STRENGTH_CAP[classifyAuthorship(a)]).toBe('strong');
  });

  it('states the cap when only the newest 300 authored commits were checked', () => {
    expect(authorshipExcerpt(authorship({ generatedOnlyCommits: 38 }))).toBe(
      'authored 412 of 460 commits, 38 only touch generated files (checked 300 of 412)',
    );
  });

  it('commits from the candidate and a colleague in similar numbers are shared, at most Medium', () => {
    const a = authorship({ totalCommits: 96, authoredCommits: 49, generatedChecked: 49 });
    expect(classifyAuthorship(a)).toBe('shared');
    expect(STRENGTH_CAP.shared).toBe('medium');
  });

  it('a repository with no commits backs nothing above Supporting', () => {
    expect(classifyAuthorship(authorship({ totalCommits: 0, authoredCommits: 0, generatedChecked: 0 }))).toBe('minor');
  });

  it('says when the commit list stopped at the newest 5000', () => {
    expect(
      authorshipExcerpt(authorship({ totalCommits: 5000, authoredCommits: 3, generatedChecked: 3, truncated: true })),
    ).toBe('authored 3 of the newest 5000 commits');
  });
});

describe('repository links, tests and CI', () => {
  it.each([
    ['https://github.com/sara-credalent-example/llm-eval-harness', 'llm-eval-harness'],
    ['https://github.com/sara-credalent-example/llm-eval-harness.git', 'llm-eval-harness'],
    ['https://github.com/sara-credalent-example/llm-eval-harness/', 'llm-eval-harness'],
  ])('reads %s', (url, name) => {
    expect(parseRepositoryUrl(url)).toEqual({ owner: 'sara-credalent-example', name });
  });

  it.each([
    'http://github.com/sara-credalent-example/llm-eval-harness',
    'https://code.credalent.example/sara/llm-eval-harness',
    'https://github.com/sara-credalent-example',
    'https://github.com/sara-credalent-example/llm-eval-harness/tree/main',
  ])('refuses %s', (url) => {
    expect(parseRepositoryUrl(url)).toBeNull();
  });

  it('finds tests and CI from file paths', () => {
    expect(detectTestsAndCi(['src/a.py', 'tests/test_a.py', '.github/workflows/ci.yml'])).toEqual({
      hasTests: true,
      hasCi: true,
    });
    expect(detectTestsAndCi(['src/a.ts', 'src/a.test.ts'])).toEqual({ hasTests: true, hasCi: false });
    expect(detectTestsAndCi(['README.md', 'src/latest.py'])).toEqual({ hasTests: false, hasCi: false });
  });
});

describe('isStale', () => {
  const checkedAt = new Date('2026-11-12T09:00:00Z');
  const days = (n: number) => new Date(checkedAt.getTime() + n * 24 * 60 * 60 * 1000);

  it('is stale only when the last check is more than 30 days old (29, 30, 31 days)', () => {
    expect(isStale({ checkedAt }, days(29), null)).toBe(false);
    expect(isStale({ checkedAt }, days(30), null)).toBe(false);
    expect(isStale({ checkedAt }, days(31), null)).toBe(true);
  });

  it('is stale when pushed after the check, not before or at it', () => {
    expect(isStale({ checkedAt }, days(8), days(-2))).toBe(false);
    expect(isStale({ checkedAt }, days(8), checkedAt)).toBe(false);
    expect(isStale({ checkedAt }, days(8), days(6))).toBe(true);
  });

  it('a source never checked is stale', () => {
    expect(isStale({ checkedAt: null }, days(0), null)).toBe(true);
  });
});
