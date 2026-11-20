// Not console code by path: the composition root that wires the console's reads holds the pool.
import { createWorkspaceDirectory } from '@credalent/workspaces/composition';
import { getDb } from './db';

export const reads = () => createWorkspaceDirectory(getDb());
