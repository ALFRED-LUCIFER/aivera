// The entry-point declarations that are not a workspace policy (AGENTS.md 1.3). `reason` is for the reviewer; the
// entry-point architecture test refuses an empty one (tests/architecture/src/entry-points.test.ts).

/** Public on purpose: no session, workspace or role is checked. `reason` says why nothing it returns or changes needs one. */
export const publicEntry = <F extends (...args: never[]) => unknown>(_reason: string, handler: F): F => handler;

/**
 * Needs only the signed-in recruiter or candidate session, because there is no workspace yet: the handler reads the
 * session itself and acts on that user alone. `reason` says what it does with it.
 */
export const sessionEntry = <F extends (...args: never[]) => unknown>(_reason: string, handler: F): F => handler;
