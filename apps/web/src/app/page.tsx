import { defaultLocale, defaultTimeZone, getTranslations } from '@aivera/i18n';
import { Button } from '@aivera/ui';
import type { ReactNode } from 'react';

const mark = (chunks: ReactNode) => <mark className="rounded-tag bg-hl px-1.5 text-hl-text">{chunks}</mark>;

export default async function Home() {
  const t = await getTranslations(defaultLocale, defaultTimeZone);
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center gap-6 px-6">
      <h1 className="font-display text-title tracking-tight">{t.rich('home.headline', { mark })}</h1>
      <p className="text-text-2">{t('home.scaffold')}</p>
      <div className="flex gap-3">
        <Button variant="primary">{t('home.createWorkspace')}</Button>
        <Button>{t('home.signIn')}</Button>
      </div>
    </main>
  );
}
