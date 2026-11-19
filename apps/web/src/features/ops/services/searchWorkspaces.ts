'use server';

import { listWorkspaceFacts, platformOperator } from '@/server/operator';
import {
  toDirectorySearch,
  workspaceSearchSchema,
  type WorkspacePage,
  type WorkspaceSearch,
} from '../domain/workspaces.ts';

/**
 * One page of the workspaces list, newest first, filtered by name on the server (ADR-012). Operators only: anyone else
 * gets a 403 and no workspace facts. The search travels in the request body, never the URL.
 */
export async function searchWorkspaces(input: WorkspaceSearch): Promise<WorkspacePage> {
  await platformOperator();
  const search = workspaceSearchSchema.parse(input);
  return { search, ...(await listWorkspaceFacts(toDirectorySearch(search))) };
}
