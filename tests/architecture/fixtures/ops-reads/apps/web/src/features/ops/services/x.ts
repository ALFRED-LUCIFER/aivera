'use server';

import type { JobCounts } from '@aivera/jobs';
import type { CandidatesContract } from '@aivera/candidates';
import { getDb } from '@/server/db';
import { listWorkspaceFacts } from '@/server/operator';
import { getWorkspaces } from '@/server/workspace';

export async function read() {
  await platformOperator();
  return [getDb, getWorkspaces, listWorkspaceFacts, null as CandidatesContract | JobCounts | null];
}
