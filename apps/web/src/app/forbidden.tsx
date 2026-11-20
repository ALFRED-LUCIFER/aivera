import { defaultLocale, defaultTimeZone, getTranslations } from '@credalent/i18n';
import { AccessMessage } from '@/features/shell/components/AccessMessage.tsx';
import { workspaceGate } from '@/features/shell/services/request.ts';

// What `forbidden()` renders, with HTTP 403: the request context refused the workspace, role or job (AIV-P0-010), or
// the workspace takes no new work: suspended (AIV-P2-037), waiting for approval or not approved (AIV-P2-039).
export default async function Forbidden() {
  const gate = await workspaceGate();
  if (gate) return <AccessMessage {...gate} />;
  const t = await getTranslations(defaultLocale, defaultTimeZone);
  return <AccessMessage title={t('access.forbiddenTitle')} body={t('access.forbidden')} />;
}
