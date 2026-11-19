import { defaultLocale, defaultTimeZone, getTranslations } from '@aivera/i18n';
import type { Metadata } from 'next';
import { loadMembers } from '@/features/members/services/loadMembers.ts';
import { PageHeader } from '@/features/shell/components/PageHeader.tsx';
import { requireScreen } from '@/features/shell/services/request.ts';
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
      <PageHeader title={t('members.title')} />
      <Members {...result.value} />
    </>
  );
}
