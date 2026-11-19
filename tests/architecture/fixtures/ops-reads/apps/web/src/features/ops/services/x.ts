'use server';

import type { JobCounts } from '@aivera/jobs';
import type { CandidatesContract } from '@aivera/candidates';
import { getDb } from '@/server/db';

export async function read() {
  await platformOperator();
  return [getDb, null as CandidatesContract | JobCounts | null];
}
