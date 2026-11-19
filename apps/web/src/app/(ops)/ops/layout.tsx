import { defaultLocale, defaultTimeZone, getTranslations, intlConfig } from '@aivera/i18n';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { OpsShell } from '@/features/ops/components/OpsShell.tsx';
import { OPS_SECTION_PAGES, OPS_SECTIONS } from '@/features/ops/domain/ops.ts';
import { signOut } from '@/features/sign-in/services/signOut.ts';
import { platformOperator } from '@/server/operator';
import { ConsoleOpened } from './ConsoleOpened.tsx';
import { OpsIntl } from './OpsIntl.tsx';

// The console is never indexed; its title is set by each page after the policy, so a 403 does not name it.
export const metadata: Metadata = { robots: { index: false, follow: false } };

// The operator console (AIV-P2-035, ADR-012). The layout and every page await the policy: Next.js renders them in
// parallel, so the layout's check alone would not stop a page.
export default async function OpsLayout({ children }: { children: ReactNode }) {
  await platformOperator();
  // Operators have no workspace, so dates show in the platform's default time zone, stated beside them.
  const [t, intl] = await Promise.all([
    getTranslations(defaultLocale, defaultTimeZone),
    intlConfig(defaultLocale, defaultTimeZone),
  ]);
  return (
    <OpsShell
      labels={{
        skipToContent: t('shell.skipToContent'),
        home: t('ops.title'),
        nav: t('ops.nav.label'),
        soon: t('ops.nav.soon'),
        signOut: t('shell.signOut'),
      }}
      sections={OPS_SECTIONS.map((id) => ({ label: t(`ops.nav.${id}`), href: OPS_SECTION_PAGES[id] }))}
      signOutAction={signOut}
    >
      <ConsoleOpened />
      <OpsIntl {...intl}>{children}</OpsIntl>
    </OpsShell>
  );
}
