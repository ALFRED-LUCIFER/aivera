import { defaultLocale, defaultTimeZone, getTranslations, intlConfig } from '@aivera/i18n';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { OPS_SECTION_PAGES, OPS_SECTIONS } from '@/features/ops/domain/ops.ts';
import { readTheme } from '@/features/shell/services/request.ts';
import { operatorName, platformOperator } from '@/server/operator';
import { ConsoleOpened } from './ConsoleOpened.tsx';
import { OpsIntl } from './OpsIntl.tsx';
import { OpsShellClient } from './OpsShellClient.tsx';

// The console is never indexed; its title is set by each page after the policy, so a 403 does not name it.
export const metadata: Metadata = { robots: { index: false, follow: false } };

// The operator console (AIV-P2-035, ADR-012). The layout and every page await the policy: Next.js renders them in
// parallel, so the layout's check alone would not stop a page.
export default async function OpsLayout({ children }: { children: ReactNode }) {
  const { userId } = await platformOperator();
  // Operators have no workspace, so dates show in the platform's default time zone, stated beside them.
  const [t, intl, theme, name] = await Promise.all([
    getTranslations(defaultLocale, defaultTimeZone),
    intlConfig(defaultLocale, defaultTimeZone),
    readTheme(),
    // Who is acting, on every page: the operator's own name (AIV-P2-052).
    operatorName(userId),
  ]);
  return (
    <OpsIntl {...intl}>
      <OpsShellClient
        labels={{
          skipToContent: t('shell.skipToContent'),
          home: t('ops.title'),
          overview: t('ops.nav.overview'),
          nav: t('ops.nav.label'),
          soon: t('ops.nav.soon'),
          later: t('ops.nav.later'),
          signOut: t('shell.signOut'),
          operator: t('ops.operator'),
          metadataOnly: t('ops.metadataOnly'),
        }}
        sections={OPS_SECTIONS.map((id) => ({ id, label: t(`ops.nav.${id}`), href: OPS_SECTION_PAGES[id] }))}
        operator={name ? { name } : undefined}
        theme={theme}
      >
        <ConsoleOpened />
        {children}
      </OpsShellClient>
    </OpsIntl>
  );
}
