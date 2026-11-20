import type { InvitationState } from '@credalent/workspaces';
import { z } from 'zod';

// Opening an invitation link (AIV-P1-003). Pure: no React, no I/O (ADR-003).

/** The link's token, from the query string (telemetry strips query strings; it never logs a path's token). */
export const invitationToken = z.string().min(1).max(200);

export type AcceptView = 'invalid' | 'signIn' | 'otherEmail' | 'join';

/**
 * What the accept page shows: "no longer valid" for a link that matches nothing or is expired, revoked or used; sign in
 * first; the wrong account; or "Join".
 */
export function acceptView(
  invitation: { state: InvitationState; email: string } | null,
  signedInEmail: string | null,
): AcceptView {
  if (invitation?.state !== 'open') return 'invalid';
  if (signedInEmail === null) return 'signIn';
  return signedInEmail.trim().toLowerCase() === invitation.email ? 'join' : 'otherEmail';
}

/** The accept page's query string for a token: sign-in returns to `/invite` with it. */
export const inviteQuery = (token: string) => `?${new URLSearchParams({ token })}`;

export type AcceptError = 'invalid' | 'otherEmail' | 'alreadyMember' | 'paused' | 'failed';
export type AcceptState = { error: AcceptError | null };
export const initialAcceptState: AcceptState = { error: null };
