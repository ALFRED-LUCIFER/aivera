'use server';

import { revalidatePath } from 'next/cache';
import { platformOperator, setApprovalRequired } from '@/server/operator';
import { approvalModeSchema, type ApprovalModeRequest } from '../domain/workspaces.ts';

/**
 * Turns "New workspaces need approval" off or on with the operator's reason (AIV-P2-039). Operators only: anyone else
 * gets a 403 and nothing changes. Approves or rejects nothing on its own.
 */
export async function setApprovalMode(input: ApprovalModeRequest): Promise<void> {
  await platformOperator();
  const { required, reason } = approvalModeSchema.parse(input);
  await setApprovalRequired(required, reason);
  revalidatePath('/ops/approvals');
}
