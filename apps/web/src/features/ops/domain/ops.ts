// The operator console (AIV-P2-035, ADR-012). Pure: no React, no I/O (ADR-003).

/** The console's sections, filled by later tickets (AIV-P2-036 to 039, AIV-P5-015 to 018); each becomes a link then. */
export const OPS_SECTIONS = ['workspaces', 'approvals', 'catalogue', 'requests', 'subscriptions', 'deletions'] as const;
type OpsSection = (typeof OPS_SECTIONS)[number];

/** The sections that have a page (a typed route each); the others show as "Coming soon". */
export const OPS_SECTION_PAGES: Partial<Record<OpsSection, '/ops/workspaces'>> = { workspaces: '/ops/workspaces' };

/**
 * Marks that this browser session already recorded "ops.console_opened" for this operator: a session cookie (no
 * max-age) holding the operator's opaque user id, cleared on sign-out, so the entry is written once per session.
 */
export const CONSOLE_OPENED_COOKIE = '__Host-aivera-ops-opened';

export const consoleOpenedCookie = (userId: string) => ({
  name: CONSOLE_OPENED_COOKIE,
  value: userId,
  httpOnly: true,
  secure: true,
  sameSite: 'lax' as const,
  path: '/',
});
