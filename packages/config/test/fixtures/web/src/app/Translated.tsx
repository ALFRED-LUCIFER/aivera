import { Button } from '@aivera/ui';

export const Translated = ({ t }: { t: (key: 'evidence.request.send') => string }) => (
  <Button>{t('evidence.request.send')}</Button>
);
