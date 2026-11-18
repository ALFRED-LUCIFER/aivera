import { defaultLocale, defaultTimeZone, intlConfig } from '@aivera/i18n';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { canOpen, navigation } from '@/features/shell/domain/navigation.ts';
import { devStandInMember, enabledFlags, loadShellCounts, readTheme } from '@/features/shell/services/request.ts';
import { RecruiterShell } from './RecruiterShell.tsx';

export default async function RecruiterLayout({ children }: { children: ReactNode }) {
  const member = devStandInMember();
  if (!member) notFound();
  const [counts, theme, intl] = await Promise.all([
    loadShellCounts(),
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
