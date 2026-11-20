import { useTranslations } from '@credalent/i18n/react';
import { Button } from '@credalent/ui';

/** A candidate page that could not load (X4), inside the candidate frame; the reason is in the server log. */
export function PageFailed({ onRetry }: { onRetry: () => void }) {
  const t = useTranslations('candidate.shell');
  return (
    <div className="flex flex-col items-start gap-3">
      <p role="alert" className="text-text-2">
        {t('failed')}
      </p>
      <Button onClick={onRetry}>{t('retry')}</Button>
    </div>
  );
}
