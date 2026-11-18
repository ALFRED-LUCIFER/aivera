import { defaultLocale, defaultTimeZone, getTranslations } from '@aivera/i18n';
import { AccessMessage } from '@/features/shell/components/AccessMessage.tsx';

// What `forbidden()` renders, with HTTP 403: the request context refused the workspace, role or job (AIV-P0-010).
export default async function Forbidden() {
  const t = await getTranslations(defaultLocale, defaultTimeZone);
  return <AccessMessage title={t('access.forbiddenTitle')} body={t('access.forbidden')} />;
}
