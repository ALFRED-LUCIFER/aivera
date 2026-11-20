import type { Db } from '@credalent/db/client';
import { createWorkspaceDirectory } from '@credalent/workspaces/composition';

export const reads = (db: Db) => createWorkspaceDirectory(db);
