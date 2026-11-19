import { defaultLocale, defaultTimeZone, getTranslations } from '@aivera/i18n';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { OpsShell } from '@/features/ops/components/OpsShell.tsx';
import { OPS_SECTIONS } from '@/features/ops/domain/ops.ts';
import { signOut } from '@/features/sign-in/services/signOut.ts';
import { platformOperator } from '@/server/operator';
import { ConsoleOpened } from './ConsoleOpened.tsx';

// The console is never indexed; its title is set by each page after the policy, so a 403 does not name it.
export const metadata: Metadata = { robots: { index: false, follow: false } };

// The operator console (AIV-P2-035, ADR-012). The layout and every page await the policy: Next.js renders them in
// parallel, so the layout's check alone would not stop a page.
export default async function OpsLayout({ children }: { children: ReactNode }) {
  await platformOperator();
  const t = await getTranslations(defaultLocale, defaultTimeZone);
  return (
    <OpsShell
      labels={{
        skipToContent: t('shell.skipToContent'),
        home: t('ops.title'),
        nav: t('ops.nav.label'),
        soon: t('ops.nav.soon'),
        signOut: t('shell.signOut'),
      }}
      sections={OPS_SECTIONS.map((id) => t(`ops.nav.${id}`))}
      signOutAction={signOut}
    >
      <ConsoleOpened />
      {children}
    </OpsShell>
  );
}
