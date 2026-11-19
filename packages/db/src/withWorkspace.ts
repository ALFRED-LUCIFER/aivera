import { sql } from 'drizzle-orm';
import type { Db, Tx } from './client.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Runs `work` in a transaction with one row-level security setting (`setting` is a code constant, never input).
 * `set_config(..., true)` is transaction-local, so a pooled connection never carries it over.
 */
function withSetting<T>(
  db: Db,
  setting: 'app.workspace_id' | 'app.candidate_account_id',
  id: string,
  work: (tx: Tx) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config(${setting}, ${id}, true)`);
    return work(tx);
  });
}

/** Runs `work` in a transaction scoped to one workspace (ADR-005): the policies read `app.workspace_id`. */
export async function withWorkspace<T>(db: Db, workspaceId: string, work: (tx: Tx) => Promise<T>): Promise<T> {
  if (!UUID.test(workspaceId)) throw new Error('withWorkspace needs a workspace id (uuid)');
  return withSetting(db, 'app.workspace_id', workspaceId, work);
}

/**
 * Runs `work` in a transaction scoped to one candidate account (ADR-009): the candidate_accounts policies read
 * `app.candidate_account_id`. No workspace is set, so workspace-owned tables return nothing in it.
 */
export async function withCandidateAccount<T>(db: Db, accountId: string, work: (tx: Tx) => Promise<T>): Promise<T> {
  if (!UUID.test(accountId)) throw new Error('withCandidateAccount needs a candidate account id (uuid)');
  return withSetting(db, 'app.candidate_account_id', accountId, work);
}
