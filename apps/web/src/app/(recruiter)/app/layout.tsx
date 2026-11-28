import { defaultLocale, defaultTimeZone, getTranslations, intlConfig } from '@credalent/i18n';
import { Button } from '@credalent/ui';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { countOngoingInterviews } from '@/features/interviews/services/loadInterviews.ts';
import { AccessMessage } from '@/features/shell/components/AccessMessage.tsx';
import { canOpen, navigation } from '@/features/shell/domain/navigation.ts';
import { currentMember, readTheme, sidebarClients, workspaceGate } from '@/features/shell/services/request.ts';
import { AuthPage, inkMark } from '@/features/sign-in/components/AuthPage.tsx';
import { signOut } from '@/features/sign-in/services/signOut.ts';
import { offeredJobTypes } from '@credalent/jobs';
import { CATCH_ALL_FOCUS, companyFromEmail } from '@/features/workspace-signup/domain/signup.ts';
import { getIdentity, getSessionUserId } from '@/server/auth';
import { isPlatformOperator } from '@/server/operator';
import { getCatalogue } from '@/server/jobs';
import { enabledFlags } from '@/server/flags';
import { CreateWorkspace } from './CreateWorkspace.tsx';
import { RecruiterShell } from './RecruiterShell.tsx';

// Each section page sets its own title ("Inbox · Credalent", WCAG 2.4.2).
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations(defaultLocale, defaultTimeZone);
  return { title: { template: t('shell.titleTemplate'), default: t('app.title') } };
}

export default async function RecruiterLayout({ children }: { children: ReactNode }) {
  // The server-side session check behind the proxy's redirect (AIV-P0-009), then the workspace context (AIV-P0-010):
  // a removed member lands on their other workspace (AIV-P2-060), and a signed-in user with no workspace (yet, or any
  // more) gets the message below (a platform operator goes to the console instead, AIV-P2-058).
  const userId = await getSessionUserId();
  if (!userId) redirect('/sign-in');
  const member = await currentMember();
  if (!member) {
    // A platform operator who belongs to no workspace runs Credalent, not a team: the console, not "create one".
    if (await isPlatformOperator(userId)) redirect('/ops');
    const [t, catalogue, user] = await Promise.all([
      getTranslations(defaultLocale, defaultTimeZone),
      getCatalogue().getPublishedCatalogue(),
      getIdentity().getUser(userId),
    ]);
    // AIV-P1-001, AIV-P1-165: they create their own and become its admin (the primary action), or ask an admin to add them.
    return (
      <AuthPage
        wordmark={t('shell.wordmark')}
        headline={t.rich('signIn.headline', { mark: inkMark })}
        points={[t('signup.points.define'), t('signup.points.rank'), t('signup.points.decide')]}
        title={t('access.noWorkspaceTitle')}
        lead={t('access.noWorkspaceLead')}
      >
        <CreateWorkspace
          company={user ? companyFromEmail(user.email) : ''}
          focusOptions={[
            ...offeredJobTypes(catalogue).map((j) => ({ value: j.key, label: j.label.en })),
            ...CATCH_ALL_FOCUS.map((value) => ({ value, label: t(`signup.focus.${value}`) })),
          ]}
          labels={{
            company: t('signup.company'),
            optional: t('signup.optional'),
            companyHint: t('signup.companyHint'),
            hiringFocus: t('signup.hiringFocus'),
            choose: t('signup.choose'),
            submit: t('signup.submit'),
            failed: t('signup.errors.failed'),
          }}
        />
        <p className="text-body text-text-2">{t('access.noWorkspace')}</p>
      </AuthPage>
    );
  }
  // AIV-P2-039: a workspace waiting for approval, or not approved, shows only why, on every recruiter route.
  const { status } = member.workspace;
  if (status === 'pending_approval' || status === 'rejected') {
    const [gate, t] = await Promise.all([workspaceGate(), getTranslations(defaultLocale, defaultTimeZone)]);
    return (
      <AccessMessage title={gate?.title ?? t('access.waitingTitle')} body={gate?.body ?? t('access.waiting')}>
        <form action={signOut} className="mt-2">
          <Button type="submit">{t('access.signOut')}</Button>
        </form>
      </AccessMessage>
    );
  }
  // shortcut: counted when the shell renders, so it is stale until the next full load; refresh it from the action
  // that changes an interview (AIV-P2-004's scorecard submit) when one exists.
  const [theme, intl, ongoing, clients] = await Promise.all([
    readTheme(),
    intlConfig(defaultLocale, defaultTimeZone),
    countOngoingInterviews(),
    sidebarClients(),
  ]);
  return (
    <RecruiterShell
      intl={intl}
      member={member}
      theme={theme}
      screens={navigation.filter((screen) => canOpen(screen, member.capabilities, enabledFlags))}
      counts={ongoing ? { interviews: ongoing } : {}}
      clients={clients}
    >
      {children}
    </RecruiterShell>
  );
}
