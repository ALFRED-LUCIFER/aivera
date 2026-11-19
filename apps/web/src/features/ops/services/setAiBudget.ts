'use server';

import { platformOperator, setWorkspaceAiBudget } from '@/server/operator';
import { aiBudgetChangeSchema, type AiBudgetChange } from '../domain/aiBudget.ts';

/**
 * Sets a workspace's daily AI token budget, or resets it to the platform default (AIV-P2-038). Operators only: anyone
 * else gets a 403 and nothing changes. Input outside the schema is refused before anything is written. The operator
 * comes from the session, never from the caller.
 */
export async function setAiBudget(input: AiBudgetChange): Promise<void> {
  await platformOperator();
  await setWorkspaceAiBudget(aiBudgetChangeSchema.parse(input));
}
