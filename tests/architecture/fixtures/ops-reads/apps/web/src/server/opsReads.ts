import type { Db } from '@aivera/db/client';
import { createWorkspaceDirectory } from '@aivera/workspaces/composition';

export const reads = (db: Db) => createWorkspaceDirectory(db);
