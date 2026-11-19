import type { NotificationsContract } from '@aivera/notifications';
import { createNotifications } from '@aivera/notifications/composition';
import { env } from './env';

let notifications: NotificationsContract | undefined;

/**
 * The app's notifications module, where emails are queued inside a confirmed action's transaction (AIV-P0-017), and the
 * public origin its links use; null when this environment has no email key or public origin.
 */
export function getNotifications(): { notifications: NotificationsContract; origin: string } | null {
  const { NOTIFICATIONS_ENCRYPTION_KEY: encryptionKey, AUTH_URL: origin, APP_ENV } = env();
  if (!encryptionKey || !origin) return null;
  // The synthetic-data band on every environment but the pilot and production (AGENTS.md 1.1).
  const synthetic = APP_ENV !== 'pilot' && APP_ENV !== 'prod';
  notifications ??= createNotifications({ encryptionKey, origin, synthetic });
  return { notifications, origin };
}
