'use server';

import { sessionEntry } from '@/server/publicEntry';

// sessionEntry whose handler never reads the session: a label, not a policy.
export const listAll = sessionEntry('lists candidates', async () => getCandidates().all());
