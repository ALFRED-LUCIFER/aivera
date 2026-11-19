// Candidate sign-in rules (AIV-P0-011). Pure: no React, no I/O (ADR-003).

export const CANDIDATE_SIGN_IN = '/candidates/sign-in';
/** Where a signed-in candidate lands: My applications. */
export const CANDIDATE_HOME = '/candidates/me';

const PROBE = 'http://aivera.invalid';

/**
 * Same-origin candidate pages only: anything else (another origin, `//host`, a scheme, the recruiter app, a non-string)
 * becomes My applications. The URL parser decides the origin and removes dot segments before the path is checked.
 */
export function candidateSafeNext(value: unknown): string {
  if (typeof value !== 'string' || !value.startsWith('/')) return CANDIDATE_HOME;
  const url = URL.parse(value, PROBE);
  const path = url?.origin === PROBE ? `${url.pathname}${url.search}${url.hash}` : CANDIDATE_HOME;
  return /^\/candidates(?:[/?#]|$)/.test(path) ? path : CANDIDATE_HOME;
}
