import { z } from 'zod';
import type { Db, Tx } from './client.ts';
import { withWorkspace } from './withWorkspace.ts';

const envelope = z.looseObject({ workspaceId: z.uuid() });

/**
 * The worker's consumer wrapper (AIV-P0-010): every queue message carries its `workspaceId`, and the handler runs
 * inside that workspace's scoped transaction. A message without a valid workspace id is dead-lettered, never handled.
 * The handler validates the rest of the message against its own schema.
 */
export function consumeInWorkspace(db: Db, handle: (message: { workspaceId: string }, tx: Tx) => Promise<void>) {
  return async (body: unknown, deadLetter: (reason: string) => Promise<void>): Promise<void> => {
    const parsed = envelope.safeParse(body);
    if (!parsed.success) return deadLetter('missing_workspace_id');
    await withWorkspace(db, parsed.data.workspaceId, (tx) => handle(parsed.data, tx));
  };
}
