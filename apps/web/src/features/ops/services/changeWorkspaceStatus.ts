'use server';

import { revalidatePath } from 'next/cache';
import { applyStatusChange, platformOperator } from '@/server/operator';
import { statusChangeSchema, workspaceHref, type StatusChangeRequest } from '../domain/workspaces.ts';

/**
 * Suspends or reactivates a workspace with the operator's reason (AIV-P2-037). Operators only: anyone else gets a 403
 * and nothing changes. The reason is checked here again, whatever the browser allowed.
 */
export async function changeWorkspaceStatus(input: StatusChangeRequest): Promise<void> {
  await platformOperator();
  const { workspaceId, change, reason } = statusChangeSchema.parse(input);
  await applyStatusChange(workspaceId, change, reason);
  revalidatePath(workspaceHref(workspaceId));
}
