import type { NotificationsContract, Sender } from '@credalent/notifications';
import { createNotifications } from '@credalent/notifications/composition';
import type { WorkspaceContext } from '@credalent/workspaces';
import { getIdentity } from './auth';
import { env } from './env';
import { getWorkspaces } from './workspace';

let notifications: NotificationsContract | undefined;

/**
 * Whether anything may leave the app here: an email, an invitation or a public job listing (OUTBOUND, AIV-P1-165). Off
 * in the pilot, so pages hide their send buttons and the server queues and publishes nothing.
 */
export const outboundOn = (): boolean => env().OUTBOUND === 'on';

/**
 * The app's notifications module, where emails are queued inside a confirmed action's transaction (AIV-P0-017), and the
 * public origin its links use; null when sending is off (OUTBOUND, which needs the email key and public origin to be on).
 * Every email the web app queues comes through here, so off, none is queued.
 */
export function getNotifications(): { notifications: NotificationsContract; origin: string } | null {
  const { NOTIFICATIONS_ENCRYPTION_KEY: encryptionKey, AUTH_URL: origin, APP_ENV } = env();
  if (!outboundOn() || !encryptionKey || !origin) return null;
  // The synthetic-data band on every environment but the pilot and production (AGENTS.md 1.1).
  const synthetic = APP_ENV !== 'pilot' && APP_ENV !== 'prod';
  notifications ??= createNotifications({ encryptionKey, origin, synthetic });
  return { notifications, origin };
}

/** The member an email is from: named in it, and its replies go to their work email. Read in the context's transaction. */
export async function senderFor(ctx: WorkspaceContext): Promise<Sender> {
  const [user, workspace] = [await getIdentity().getUser(ctx.userId, ctx), await getWorkspaces().getWorkspace(ctx)];
  if (!user || !workspace) throw new Error('sender or workspace not found');
  const name = user.displayName ?? user.email;
  return { name, shortName: name.split(' ')[0] ?? name, email: user.email, workspace: workspace.name };
}
