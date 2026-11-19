'use server';

import { signOut as endSession } from '@/server/auth';

/** Public: ends only the caller's own session (clears `__Host-aivera-session`) and lands on the sign-in page. */
export async function signOut(): Promise<void> {
  await endSession({ redirectTo: '/sign-in' });
}
