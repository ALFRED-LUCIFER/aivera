import { defaultLocale, defaultTimeZone, getTranslations, intlConfig } from '@aivera/i18n';
import { Button } from '@aivera/ui';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { AccessMessage } from '@/features/shell/components/AccessMessage.tsx';
import { canOpen, navigation } from '@/features/shell/domain/navigation.ts';
import { currentMember, loadShellCounts, readTheme, workspaceGate } from '@/features/shell/services/request.ts';
import { signOut } from '@/features/sign-in/services/signOut.ts';
import { HIRING_FOCUS } from '@/features/workspace-signup/domain/signup.ts';
import { getSessionUserId } from '@/server/auth';
import { enabledFlags } from '@/server/flags';
import { CreateWorkspace } from './CreateWorkspace.tsx';
import { RecruiterShell } from './RecruiterShell.tsx';

// Each section page sets its own title ("Inbox · Aivera", WCAG 2.4.2).
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations(defaultLocale, defaultTimeZone);
  return { title: { template: t('shell.titleTemplate'), default: t('app.title') } };
}

export default async function RecruiterLayout({ children }: { children: ReactNode }) {
  // The server-side session check behind the proxy's redirect (AIV-P0-009), then the workspace context (AIV-P0-010):
  // a removed member gets the 403 page, a signed-in user with no workspace yet gets the message below.
  if (!(await getSessionUserId())) redirect('/sign-in');
  const member = await currentMember();
  if (!member) {
    const t = await getTranslations(defaultLocale, defaultTimeZone);
    // AIV-P1-001: or they create their own, and become its admin.
    return (
      <AccessMessage title={t('access.noWorkspaceTitle')} body={t('access.noWorkspace')}>
        <CreateWorkspace
          focusOptions={HIRING_FOCUS.map((value) => ({
            value,
            label: t(value === 'several' || value === 'other' ? `signup.focus.${value}` : `jobTypes.${value}.label`),
          }))}
          labels={{
            title: t('signup.title'),
            company: t('signup.company'),
            optional: t('signup.optional'),
            companyHint: t('signup.companyHint'),
            hiringFocus: t('signup.hiringFocus'),
            choose: t('signup.choose'),
            submit: t('signup.submit'),
            failed: t('signup.errors.failed'),
          }}
        />
      </AccessMessage>
    );
  }
  // AIV-P2-039: a workspace waiting for approval, or not approved, shows only why, on every recruiter route.
  const { status } = member.workspace;
  if (status === 'pending_approval' || status === 'rejected') {
    const [gate, t] = await Promise.all([workspaceGate(), getTranslations(defaultLocale, defaultTimeZone)]);
    return (
      <AccessMessage title={gate?.title ?? t('access.waitingTitle')} body={gate?.body ?? t('access.waiting')}>
        <form action={signOut}>
          <Button type="submit">{t('access.signOut')}</Button>
        </form>
      </AccessMessage>
    );
  }
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
