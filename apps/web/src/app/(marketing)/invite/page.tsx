import { defaultLocale, defaultTimeZone, getTranslations } from '@credalent/i18n';
import { buttonClassName } from '@credalent/ui';
import type { Metadata, Route } from 'next';
import Link from 'next/link';
import { AcceptInvitation } from '@/features/members/components/AcceptInvitation.tsx';
import { acceptView, invitationToken, inviteQuery } from '@/features/members/domain/accept.ts';
import { signInPath } from '@/features/sign-in/domain/signIn.ts';
import { signOut } from '@/features/sign-in/services/signOut.ts';
import { getIdentity, getSessionUserId } from '@/server/auth';
import { getWorkspaces } from '@/server/workspace';
import { Join } from './Join.tsx';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations(defaultLocale, defaultTimeZone))('members.accept.title') };
}

// Public: an invitation link (AIV-P1-003). The token travels in the query string, which telemetry strips. Reading it
// shows only the workspace's name and the invited role; joining needs a session whose verified email is the invited one.
export default async function InvitePage({ searchParams }: PageProps<'/invite'>) {
  const token = invitationToken.safeParse((await searchParams).token);
  const found = token.success ? await getWorkspaces().findInvitation(token.data) : null;
  const userId = await getSessionUserId();
  const email = userId ? ((await getIdentity().getUser(userId))?.email ?? null) : null;
  const view = acceptView(found && { state: found.state, email: found.invitation.email }, email);
  const t = await getTranslations(defaultLocale, defaultTimeZone);
  if (!found || !token.success || view === 'invalid')
    return <AcceptInvitation title={t('members.accept.invalidTitle')} body={t('members.accept.invalid')} />;
  const invited = t('members.accept.body', {
    workspace: found.workspaceName,
    role: t(`members.roles.${found.invitation.role}`),
  });
  if (view === 'signIn')
    return (
      <AcceptInvitation title={t('members.accept.title')} body={invited}>
        <Link
          href={signInPath('/invite', inviteQuery(token.data)) as Route}
          className={`${buttonClassName('primary')} self-start`}
        >
          {t('members.accept.signIn')}
        </Link>
      </AcceptInvitation>
    );
  if (view === 'otherEmail')
    return (
      <AcceptInvitation title={t('members.accept.title')} body={t('members.accept.otherEmail')}>
        <form action={signOut}>
          <button type="submit" className={buttonClassName('primary')}>
            {t('access.signOut')}
          </button>
        </form>
      </AcceptInvitation>
    );
  return (
    <AcceptInvitation title={t('members.accept.title')} body={invited}>
      <Join
        token={token.data}
        label={t('members.accept.join', { workspace: found.workspaceName })}
        errors={{
          invalid: t('members.accept.invalid'),
          otherEmail: t('members.accept.otherEmail'),
          alreadyMember: t('members.accept.alreadyMember'),
          paused: t('access.pausedTitle'),
          failed: t('members.accept.failed'),
        }}
      />
    </AcceptInvitation>
  );
}
