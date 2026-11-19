'use server';

import { cookies } from 'next/headers';
import { getAudit, platformOperator } from '@/server/operator';
import { CONSOLE_OPENED_COOKIE, consoleOpenedCookie } from '../domain/ops.ts';

/**
 * Records "ops.console_opened" in the platform audit log once per session (ADR-012). Operators only: anyone else gets
 * a 403 and nothing is written. The operator comes from the session, never from the caller.
 */
export async function openConsole(): Promise<void> {
  const { userId } = await platformOperator();
  const jar = await cookies();
  if (jar.get(CONSOLE_OPENED_COOKIE)?.value === userId) return;
  await getAudit().recordPlatform({ actorId: userId, action: 'ops.console_opened' });
  jar.set(consoleOpenedCookie(userId));
}
