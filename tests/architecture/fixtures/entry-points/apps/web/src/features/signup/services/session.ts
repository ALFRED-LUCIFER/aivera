// A comment before the directive still makes this a server action file.
'use server';

import { getSessionUserId } from '@/server/auth';
import { sessionEntry } from '@/server/publicEntry';

// Undeclared: reading the session is not a policy.
export async function readsSession() {
  const userId = await getSessionUserId();
  return getWorkspaces().list(userId);
}

// Declared: sessionEntry with its reason.
export const createWorkspace = sessionEntry('creates the first workspace of the signed-in user', async () => {
  await getSessionUserId();
});
