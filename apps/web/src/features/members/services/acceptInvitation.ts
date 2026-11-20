'use server';

import { log } from '@credalent/observability';
import { WorkspaceError, WorkspacePausedError, type WorkspaceErrorCode } from '@credalent/workspaces';
import type { Route } from 'next';
import { revalidatePath } from 'next/cache';
import { forbidden, redirect } from 'next/navigation';
import { DESK, signInPath } from '@/features/sign-in/domain/signIn.ts';
import { getIdentity, getSessionUserId } from '@/server/auth';
import { getWorkspaces } from '@/server/workspace';
import { invitationToken, inviteQuery, type AcceptError, type AcceptState } from '../domain/accept.ts';

const ERRORS: Partial<Record<WorkspaceErrorCode, AcceptError>> = {
  invitation_invalid: 'invalid',
  invitation_email: 'otherEmail',
  already_member: 'alreadyMember',
};

/**
 * "Join" on an invitation link (AIV-P1-003): session only, since the user is not a member yet. The signed-in user's
 * verified email (from identity, never the form) must be the invited one; the module then adds them with the invited
 * role and job grants, makes the workspace their active one and audits it, in one transaction.
 */
export async function acceptInvitation(_previous: AcceptState, form: FormData): Promise<AcceptState> {
  const token = invitationToken.safeParse(form.get('token'));
  if (!token.success) return { error: 'invalid' };
  const userId = await getSessionUserId();
  if (!userId) redirect(signInPath('/invite', inviteQuery(token.data)) as Route);
  const user = await getIdentity().getUser(userId);
  if (!user) forbidden();
  try {
    await getWorkspaces().acceptInvitation({ userId, email: user.email }, token.data);
  } catch (error) {
    if (error instanceof WorkspacePausedError) return { error: 'paused' };
    const known = error instanceof WorkspaceError ? ERRORS[error.code] : undefined;
    if (known) return { error: known };
    log.error(
      { area: 'members-accept', 'error.type': error instanceof Error ? error.name : 'unknown' },
      'accept failed',
    );
    return { error: 'failed' };
  }
  // The recruiter layout may have rendered the no-workspace page for this user; drop it so the shell renders.
  revalidatePath(DESK, 'layout');
  redirect(DESK);
}
