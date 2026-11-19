import { defaultLocale, defaultTimeZone, getTranslations } from '@aivera/i18n';
import { AccessMessage } from '@/features/shell/components/AccessMessage.tsx';
import { currentMembership } from '@/server/workspace';

// What `forbidden()` renders, with HTTP 403: the request context refused the workspace, role or job (AIV-P0-010), or
// the workspace is suspended and the request would start new work (AIV-P2-037).
export default async function Forbidden() {
  const t = await getTranslations(defaultLocale, defaultTimeZone);
  // Any failure here (no session, not a member) is the plain refusal: this page never throws a second time.
  const membership = await currentMembership().catch(() => null);
  return membership?.status === 'suspended' ? (
    <AccessMessage title={t('access.pausedTitle')} body={t('access.paused')} />
  ) : (
    <AccessMessage title={t('access.forbiddenTitle')} body={t('access.forbidden')} />
  );
}
