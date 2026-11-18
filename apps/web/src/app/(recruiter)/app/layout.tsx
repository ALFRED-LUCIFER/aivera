import { defaultLocale, defaultTimeZone, getTranslations, intlConfig } from '@aivera/i18n';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { canOpen, navigation } from '@/features/shell/domain/navigation.ts';
import { devStandInMember, enabledFlags, loadShellCounts, readTheme } from '@/features/shell/services/request.ts';
import { RecruiterShell } from './RecruiterShell.tsx';

// Each section page sets its own title ("Inbox · Aivera", WCAG 2.4.2).
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations(defaultLocale, defaultTimeZone);
  return { title: { template: t('shell.titleTemplate'), default: t('app.title') } };
}

export default async function RecruiterLayout({ children }: { children: ReactNode }) {
  const member = devStandInMember();
  if (!member) notFound();
  const [counts, theme, intl] = await Promise.all([
    loadShellCounts(member),
    readTheme(),
    intlConfig(defaultLocale, defaultTimeZone),
  ]);
  return (
    <RecruiterShell
      intl={intl}
      member={member}
      counts={counts}
      theme={theme}
      screens={navigation.filter((screen) => canOpen(screen, member.capabilities, enabledFlags))}
    >
      {children}
    </RecruiterShell>
  );
}
