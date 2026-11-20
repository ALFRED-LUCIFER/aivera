/**
 * Marks a server action or route handler as public on purpose (AGENTS.md 1.3): no session, workspace or role is checked.
 * `reason` is for the reviewer: what the entry point does and why nothing it returns or changes needs a policy. The
 * entry-point architecture test refuses an empty reason (tests/architecture/src/entry-points.test.ts).
 */
export const publicEntry = <F extends (...args: never[]) => unknown>(_reason: string, handler: F): F => handler;
