import { defaultLocale, defaultTimeZone, getTranslations } from '@credalent/i18n';
import { buttonClassName } from '@credalent/ui';
import Link from 'next/link';
import { AccessMessage } from '@/features/shell/components/AccessMessage.tsx';

// Any address no route owns, and any notFound() with no closer not-found page: the same words, no id or path echoed.
export default async function NotFound() {
  const t = await getTranslations(defaultLocale, defaultTimeZone);
  return (
    <AccessMessage title={t('access.notFoundTitle')}>
      <Link href="/" className={`${buttonClassName('secondary')} self-start`}>
        {t('access.home')}
      </Link>
    </AccessMessage>
  );
}
