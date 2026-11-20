'use server';

import { settingsSchema, type WorkspaceSettings } from '@credalent/workspaces';
import { revalidatePath } from 'next/cache';
import { forbidden } from 'next/navigation';
import { getWorkspaces, inActiveWorkspace } from '@/server/workspace';

/**
 * "Save settings" (AIV-P1-052): validates every value against the workspaces module's bounds (AGENTS.md 3.7), then
 * saves them in the active workspace. Admins only: `updateSettings` authorises `workspace.settings`, and anyone else
 * gets the 403 page. Each changed value is audited by the module.
 */
export async function saveSettings(input: WorkspaceSettings): Promise<WorkspaceSettings> {
  const settings = settingsSchema.strict().parse(input);
  const result = await inActiveWorkspace((ctx) => getWorkspaces().updateSettings(ctx, settings));
  if (!result) forbidden();
  revalidatePath('/app/settings');
  return result.value;
}
