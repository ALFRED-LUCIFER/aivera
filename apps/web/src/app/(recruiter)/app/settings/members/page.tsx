import { defaultLocale, defaultTimeZone, getTranslations } from '@credalent/i18n';
import type { Metadata } from 'next';
import Link from 'next/link';
import { loadMembers } from '@/features/members/services/loadMembers.ts';
import { PageHeader } from '@/features/shell/components/PageHeader.tsx';
import { requireScreen } from '@/features/shell/services/request.ts';
import { outboundOn } from '@/server/notifications';
import { inActiveWorkspace } from '@/server/workspace';
import { Members } from './Members.tsx';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations(defaultLocale, defaultTimeZone))('members.title') };
}

// Workspace members (AIV-P1-003): admins only; `loadMembers` authorises `member.invite`, anyone else gets the 403 page.
export default async function MembersPage() {
  const result = await inActiveWorkspace(loadMembers);
  // No workspace yet: the recruiter layout shows the create-workspace page instead of this one.
  if (!result) return null;
  await requireScreen('settings');
  const t = await getTranslations(defaultLocale, defaultTimeZone);
  return (
    <>
      <PageHeader
        breadcrumb={
          <nav aria-label={t('members.breadcrumb')} className="text-meta text-text-2">
            <Link href="/app/settings" className="underline underline-offset-2 hover:text-text">
              {t('shell.nav.settings')}
            </Link>
          </nav>
        }
        title={t('members.title')}
      />
      <Members {...result.value} outbound={outboundOn()} />
    </>
  );
}
