import { useTranslations } from '@credalent/i18n/react';
import { Button } from '@credalent/ui';
import { AccessMessage } from './AccessMessage.tsx';

/** A page threw while rendering and no closer boundary caught it. Never shows the error: its text may carry data. */
export function RootError({ onRetry }: { onRetry: () => void }) {
  const t = useTranslations('access');
  return (
    <AccessMessage title={t('errorTitle')}>
      <Button className="self-start" onClick={onRetry}>
        {t('retry')}
      </Button>
    </AccessMessage>
  );
}
