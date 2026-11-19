import type { AuditContract } from '@aivera/audit';
import { createAudit } from '@aivera/audit/composition';
import { forbidden, redirect } from 'next/navigation';
import { getIdentity, getSessionUserId } from './auth';
import { getDb } from './db';
import { env } from './env';

// The platformOperator policy (AIV-P2-035, ADR-012): the operator console at /ops is for the people who run Aivera,
// named in PLATFORM_OPERATOR_EMAILS. It is not a workspace role and grants nothing inside any workspace.

/**
 * Whether the identity user's stored email (verified and lower-case, ADR-009 point 4) is a configured operator. Read on
 * every call, never cached in the session, so an email removed from the list stops working on the next request.
 */
export async function isPlatformOperator(userId: string): Promise<boolean> {
  const operators = env().platformOperators;
  // No list, an empty list or an invalid one: nobody is an operator (fails closed), and no database read is needed.
  if (operators.size === 0) return false;
  const user = await getIdentity().getUser(userId);
  return user !== null && operators.has(user.email);
}

/**
 * The policy every /ops page, layout, server action and route handler awaits before anything else (architecture-test
 * enforced). No session goes to sign-in and back to /ops; a signed-in non-operator gets the 403 page, or a 403 from an
 * action or route handler, and nothing of the console.
 */
export async function platformOperator(): Promise<{ userId: string }> {
  const userId = await getSessionUserId();
  // signInPath('/ops', '') as a literal, which typed routes accept; a deeper /ops path keeps its own return in the proxy.
  if (!userId) redirect('/sign-in?next=%2Fops');
  if (!(await isPlatformOperator(userId))) forbidden();
  return { userId };
}

let audit: AuditContract | undefined;
/** The audit module for operator actions: `recordPlatform`, and `record` inside the target workspace (ADR-012). */
export const getAudit = (): AuditContract => (audit ??= createAudit(getDb()));
