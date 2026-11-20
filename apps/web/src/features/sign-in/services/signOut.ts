'use server';

import { cookies } from 'next/headers';
import { consoleOpenedCookie } from '@/features/ops/domain/ops.ts';
import { signOut as endSession } from '@/server/auth';

/**
 * Public: ends only the caller's own session (clears `__Host-credalent-session`) and lands on the sign-in page. Also clears
 * the console's once-per-session marker, so the next operator session records "ops.console_opened" again (ADR-012).
 */
export async function signOut(): Promise<void> {
  // Expired with the same attributes: a __Host- cookie is only replaced by a Secure, path=/ one.
  (await cookies()).set({ ...consoleOpenedCookie(''), maxAge: 0 });
  await endSession({ redirectTo: '/sign-in' });
}
