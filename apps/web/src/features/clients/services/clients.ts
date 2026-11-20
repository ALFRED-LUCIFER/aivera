'use server';

import { log } from '@credalent/observability';
import { WorkspaceError, type WorkspaceContext } from '@credalent/workspaces';
import { revalidatePath } from 'next/cache';
import { forbidden, unstable_rethrow } from 'next/navigation';
import { getWorkspaces, inActiveWorkspace } from '@/server/workspace';
import { clientIdSchema, clientNameSchema, type ClientResult } from '../domain/clients.ts';

/**
 * Runs a client change in the active workspace. The workspaces module authorises `client.manage` (admins and
 * recruiters; anyone else gets the 403 page) and audits it; a name rule it refuses comes back as the field's message.
 */
async function change(work: (ctx: WorkspaceContext) => Promise<unknown>): Promise<ClientResult> {
  try {
    const result = await inActiveWorkspace(work);
    if (!result) forbidden();
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof WorkspaceError && error.code === 'client_exists') return { ok: false, error: 'exists' };
    if (error instanceof WorkspaceError && error.code === 'client_name') return { ok: false, error: 'name' };
    // The name only: an error's detail can repeat the client's name.
    log.error({ area: 'clients', 'error.type': error instanceof Error ? error.name : 'unknown' }, 'change failed');
    return { ok: false, error: 'failed' };
  }
  revalidatePath('/app/settings/clients');
  return { ok: true };
}

/** "Add client" (AIV-P1-056). */
export async function addClient(name: string): Promise<ClientResult> {
  const parsed = clientNameSchema.safeParse(name);
  if (!parsed.success) return { ok: false, error: 'name' };
  return change((ctx) => getWorkspaces().addClient(ctx, parsed.data));
}

/** "Rename" a client. */
export async function renameClient(clientId: string, name: string): Promise<ClientResult> {
  const parsed = clientNameSchema.safeParse(name);
  if (!parsed.success) return { ok: false, error: 'name' };
  const id = clientIdSchema.safeParse(clientId);
  if (!id.success) return { ok: false, error: 'failed' };
  return change((ctx) => getWorkspaces().renameClient(ctx, id.data, parsed.data));
}

/** "Archive" a client: its jobs stay; it is not offered for new jobs. */
export async function archiveClient(clientId: string): Promise<ClientResult> {
  const id = clientIdSchema.safeParse(clientId);
  if (!id.success) return { ok: false, error: 'failed' };
  return change((ctx) => getWorkspaces().archiveClient(ctx, id.data));
}
