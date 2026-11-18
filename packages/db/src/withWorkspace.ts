import { sql } from 'drizzle-orm';
import type { Db, Tx } from './client.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Runs `work` in a transaction scoped to one workspace (ADR-005). Row-level security policies read
 * `app.workspace_id`; `set_config(..., true)` is transaction-local, so a pooled connection never carries it over.
 */
export async function withWorkspace<T>(db: Db, workspaceId: string, work: (tx: Tx) => Promise<T>): Promise<T> {
  if (!UUID.test(workspaceId)) throw new Error('withWorkspace needs a workspace id (uuid)');
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.workspace_id', ${workspaceId}, true)`);
    return work(tx);
  });
}
