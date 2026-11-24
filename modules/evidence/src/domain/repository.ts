// How much of a public GitHub repository is the candidate's (AIV-P1-026). Pure rules over numbers the reader measured:
// a README's claims, repository ownership and admin rights never enter them.
import type { Strength } from './evidence.ts';

/** pending until read; `not_accessible` for a private or missing repository; `fork` when GitHub reports a fork. */
export const REPOSITORY_READ_STATUSES = ['pending', 'read', 'not_accessible', 'fork'] as const;
export type RepositoryReadStatus = (typeof REPOSITORY_READ_STATUSES)[number];

/**
 * Who the commits are matched to: the login and the emails the candidate supplied, lower case. Never derived from a
 * name, an email or the repository owner (AIV-P1-076): with no login supplied, only the emails match.
 */
export type CommitIdentity = { login: string | null; emails: readonly string[] };

/** One commit on the default branch as the reader sees it. The message is read for trailers only, never stored. */
export type Commit = { sha: string; authorLogin: string | null; authorEmail: string | null; message: string };

/** How a repository read came about: from a GitHub profile the CV links (AIV-P1-112). Null: a link to the repository. */
export const REPOSITORY_VIAS = ['cv_profile'] as const;
export type RepositoryVia = (typeof REPOSITORY_VIAS)[number];

const GITHUB_LOGIN = /^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){0,38}$/;

export const normaliseLogin = (login: string) => login.trim().replace(/^@/, '').toLowerCase();
export const isGitHubLogin = (login: string) => GITHUB_LOGIN.test(login);

/**
 * `https://github.com/<owner>/<repo>` (optionally `.git`, a trailing slash, a query or a fragment), lower-cased as
 * GitHub treats both case-insensitively, or null for anything else (a profile, a gist, a file, another host).
 */
export function parseRepositoryUrl(url: string): { owner: string; name: string } | null {
  const parsed = URL.parse(url);
  if (parsed?.protocol !== 'https:' || parsed.hostname !== 'github.com') return null;
  const match = /^\/([A-Za-z0-9-]{1,39})\/([A-Za-z0-9._-]{1,100}?)(?:\.git)?\/?$/.exec(parsed.pathname);
  return match?.[1] && match[2] ? { owner: match[1].toLowerCase(), name: match[2].toLowerCase() } : null;
}

/** Shown on a read made with no GitHub login: only the candidate's emails matched commits, so Strong is out of reach. */
export const NO_LOGIN_LIMIT = 'Authorship unclear: no GitHub login supplied.';

// `12345+login@users.noreply.github.com` and `login@users.noreply.github.com` are GitHub's private addresses for a login.
const NOREPLY = /^(?:\d+\+)?([^@]+)@users\.noreply\.github\.com$/;
const CO_AUTHOR = /^co-authored-by:[^<\n]*<([^>\n]+)>\s*$/gim;

function isCandidateEmail(email: string, who: CommitIdentity): boolean {
  const value = email.trim().toLowerCase();
  return who.emails.includes(value) || (who.login !== null && NOREPLY.exec(value)?.[1] === who.login);
}

/** Matched by the commit's GitHub login, its author email, or a Co-authored-by trailer; nothing else counts. */
export function isAuthoredBy(commit: Commit, who: CommitIdentity): boolean {
  if (who.login !== null && commit.authorLogin?.toLowerCase() === who.login) return true;
  if (commit.authorEmail && isCandidateEmail(commit.authorEmail, who)) return true;
  return [...commit.message.matchAll(CO_AUTHOR)].some(
    ([, email]) => email !== undefined && isCandidateEmail(email, who),
  );
}

const LOCKFILES = new Set(['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'poetry.lock', 'Cargo.lock', 'go.sum']);
const GENERATED_DIRS = new Set(['node_modules', 'vendor', 'third_party', 'dist', 'build', 'target']);

function isGeneratedPath(path: string): boolean {
  const parts = path.split('/');
  const file = parts.pop() ?? '';
  return LOCKFILES.has(file) || /\.min\.(?:js|css)$/.test(file) || parts.some((dir) => GENERATED_DIRS.has(dir));
}

/** A commit that changes only lockfiles, vendored or built files. A commit with no listed file is not one. */
export const isGeneratedOnly = (paths: readonly string[]) => paths.length > 0 && paths.every(isGeneratedPath);

// shortcut: generated-only check covers the newest 300 authored commits, and the source states "checked 300 of 412"
// when capped; raise the cap if pilot repositories exceed it.
export const GENERATED_CHECK_CAP = 300;
// shortcut: the commit list reads the newest 5,000 commits on the default branch, and the source says "of the newest
// 5000 commits" when it stops there; raise it if pilot repositories exceed it.
export const COMMIT_LIST_CAP = 5000;

export type Authorship = {
  totalCommits: number;
  authoredCommits: number;
  /** Of the `generatedChecked` newest authored commits, those that only touch generated files. */
  generatedOnlyCommits: number;
  generatedChecked: number;
  /** True when the commit list stopped at COMMIT_LIST_CAP. */
  truncated: boolean;
};

/**
 * The share evidence mapping (AIV-P1-027) caps strength by: generated-only commits leave the numerator, so bulk
 * lockfile commits cannot inflate it. Commit counts only; merged pull requests are never added in.
 */
export const authorshipShare = (a: Authorship) => ({
  numerator: a.authoredCommits - a.generatedOnlyCommits,
  denominator: a.totalCommits,
});

/** clear: at least three quarters of the commits are the candidate's; shared: at least a quarter; minor: less. */
export type AuthorshipClass = 'clear' | 'shared' | 'minor';

export function classifyAuthorship(a: Authorship): AuthorshipClass {
  const { numerator, denominator } = authorshipShare(a);
  if (denominator === 0) return 'minor';
  const share = numerator / denominator;
  return share >= 0.75 ? 'clear' : share >= 0.25 ? 'shared' : 'minor';
}

/** The strongest evidence a repository can back (the Rubric page: Strong needs authorship clear). */
export const STRENGTH_CAP: Record<AuthorshipClass, Strength> = {
  clear: 'strong',
  shared: 'medium',
  minor: 'supporting',
};

/** The read's cap: with no GitHub login supplied, authorship is unclear, so never above Medium (AIV-P1-076). */
export const strengthCapOf = (cls: AuthorshipClass, hasLogin: boolean): Strength =>
  hasLogin || cls !== 'clear' ? STRENGTH_CAP[cls] : 'medium';

/**
 * The repository item's own strength: never Strong, which also needs a second source (AIV-P1-029 corroborates);
 * Supporting when the candidate wrote little of it.
 */
export const itemStrength = (a: Authorship): Strength => (classifyAuthorship(a) === 'minor' ? 'supporting' : 'medium');

/** "authored 412 of 460 commits, 38 only touch generated files": measured numbers only, never the README. */
export function authorshipExcerpt(a: Authorship): string {
  const of = a.truncated ? `of the newest ${a.totalCommits} commits` : `of ${a.totalCommits} commits`;
  const generated = a.generatedOnlyCommits ? `, ${a.generatedOnlyCommits} only touch generated files` : '';
  const capped =
    a.generatedChecked < a.authoredCommits ? ` (checked ${a.generatedChecked} of ${a.authoredCommits})` : '';
  return `authored ${a.authoredCommits} ${of}${generated}${capped}`;
}

export const AUTHORSHIP_LIMIT =
  'Measured from the commit history of the default branch; does not show code quality or who reviewed the work.';

/** Presence of tests and CI from the repository's file list; file contents are never read. */
export function detectTestsAndCi(paths: readonly string[]): { hasTests: boolean; hasCi: boolean } {
  return {
    hasTests: paths.some(
      (p) =>
        /(?:^|\/)(?:tests?|__tests__|spec)\//.test(p) ||
        /[._](?:test|spec)\.[a-z]+$/.test(p) ||
        /(?:^|\/)test_[^/]+\.py$/.test(p),
    ),
    hasCi: paths.some(
      (p) =>
        p.startsWith('.github/workflows/') ||
        p.startsWith('.circleci/') ||
        ['.gitlab-ci.yml', 'azure-pipelines.yml', 'Jenkinsfile'].includes(p),
    ),
  };
}

/** A pull request the candidate authored, merged into a repository they do not own (not a fork). */
export type MergedPullRequest = { repository: string; number: number; mergedAt: Date; mergedBy: string | null };

export const isSelfMerged = (pr: MergedPullRequest, login: string) => pr.mergedBy?.toLowerCase() === login;

export function mergedPullRequestExcerpt(pr: MergedPullRequest, login: string): string {
  const by = isSelfMerged(pr, login) ? 'the candidate (self-merged)' : (pr.mergedBy ?? 'an unknown account');
  return `Pull request #${pr.number} to ${pr.repository}, merged on ${pr.mergedAt.toISOString().slice(0, 10)} by ${by}`;
}

export const MERGED_PULL_REQUEST_LIMIT =
  'Shows that a pull request was merged; does not show what the change contained or how closely it was reviewed.';

// Adapted from MIT-licensed code, © 2026 Santiago Fernández de Valderrama. Licence text: THIRD_PARTY_NOTICES.md.
const STALE_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Whether a repository source must be re-read before a decision pack rests on it (AIV-P1-072): never checked, checked
 * more than 30 days before `now`, or pushed to since it was checked.
 */
export const isStale = (source: { checkedAt: Date | null }, now: Date, latestPushedAt: Date | null) =>
  source.checkedAt === null ||
  now.getTime() - source.checkedAt.getTime() > STALE_AFTER_MS ||
  (latestPushedAt !== null && latestPushedAt > source.checkedAt);

/** pending until the worker has listed the profile; `not_expandable` for an organisation or a profile GitHub does not have. */
export const PROFILE_EXPANSION_STATUSES = ['pending', 'expanded', 'not_expandable'] as const;
export type ProfileExpansionStatus = (typeof PROFILE_EXPANSION_STATUSES)[number];

/** The most repositories read from the profiles of one candidate, all together. */
export const PROFILE_REPOSITORY_CAP = 5;

/** A repository GitHub lists for a user, as the reader sees it. */
export type OwnedRepository = {
  name: string;
  fork: boolean;
  archived: boolean;
  private: boolean;
  /** In KB, 0 for an empty repository. */
  size: number;
  pushedAt: Date | null;
};

/** A profile's own public work, newest push first: no fork, no archived, no empty or private repository. */
export const chooseProfileRepositories = (repositories: readonly OwnedRepository[]): string[] =>
  repositories
    .filter(
      (r) =>
        !r.fork &&
        !r.archived &&
        !r.private &&
        r.size > 0 &&
        r.pushedAt !== null &&
        parseRepositoryUrl(`https://github.com/x/${r.name}`),
    )
    .toSorted((a, b) => (b.pushedAt?.getTime() ?? 0) - (a.pushedAt?.getTime() ?? 0))
    .map((r) => r.name);
