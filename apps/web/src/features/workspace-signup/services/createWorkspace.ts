'use server';

import { log } from '@aivera/observability';
import { revalidatePath } from 'next/cache';
import { forbidden, redirect } from 'next/navigation';
import { getIdentity, getSessionUserId } from '@/server/auth';
import { getWorkspaces } from '@/server/workspace';
import { DESK } from '@/features/sign-in/domain/signIn.ts';
import { parseCreateWorkspaceForm, workspaceName, type CreateWorkspaceState } from '../domain/signup.ts';

/**
 * Session only: there is no workspace yet, so no role to check. The signed-in user (never an id from the form) becomes
 * the new workspace's admin and lands in it on My desk; the module audits it in the same transaction.
 */
export async function createWorkspace(_previous: CreateWorkspaceState, form: FormData): Promise<CreateWorkspaceState> {
  const userId = await getSessionUserId();
  if (!userId) redirect('/sign-in');
  // Creating a second workspace would silently switch the user out of their current one.
  // shortcut: one workspace per creator; creating and switching between more is AIV-P1-055.
  if (await getWorkspaces().activeWorkspace(userId)) forbidden();
  const user = await getIdentity().getUser(userId);
  if (!user) forbidden();
  const failed: CreateWorkspaceState = {
    error: 'failed',
    values: { company: String(form.get('company') ?? ''), hiringFocus: String(form.get('hiringFocus') ?? '') },
  };
  const input = parseCreateWorkspaceForm(form);
  if (!input) return failed;
  try {
    await getWorkspaces().createWorkspace({
      // No display name from the tenant: the workspace is named after the email, which only its members see.
      name: workspaceName(input.company, user.displayName ?? user.email),
      company: input.company,
      hiringFocus: input.hiringFocus,
      creatorUserId: userId,
    });
  } catch (error) {
    // The name only: a database error's detail can repeat the company or the person's name (AGENTS.md 1.2).
    log.error({ area: 'workspace-signup', error: error instanceof Error ? error.name : 'unknown' }, 'create failed');
    return failed;
  }
  // The recruiter layout rendered the no-workspace page at this same path; drop it so the shell renders instead.
  revalidatePath(DESK, 'layout');
  redirect(DESK);
}
