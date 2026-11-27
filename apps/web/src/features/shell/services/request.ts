import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { enabledFlags } from '@/server/flags';
import { defaultLocale, defaultTimeZone, getTranslations } from '@credalent/i18n';
import { currentMembership, rejectionReason } from '@/server/workspace';
import { canOpen, navigation, type ScreenId } from '../domain/navigation.ts';
import { parseTheme, shellMember, themeCookie, type Member } from '../domain/shell.ts';

/**
 * The signed-in member in their active workspace. Null when they belong to no workspace yet; a removed member gets
 * the 403 page and no session goes to sign-in (AIV-P0-010).
 */
export async function currentMember(): Promise<Member | null> {
  const membership = await currentMembership();
  return membership && shellMember(membership);
}

const opens = (member: Member, id: ScreenId) => {
  const screen = navigation.find((s) => s.id === id);
  return !!screen && canOpen(screen, member.capabilities, enabledFlags);
};

/** The route guard every recruiter page awaits: no member, no capability or flag off is a 404. */
export async function requireScreen(id: ScreenId): Promise<Member> {
  const member = await currentMember();
  if (!member || !opens(member, id)) notFound();
  return member;
}

/** Whether the signed-in member may open a section, for a link to it outside the sidebar. */
export async function mayOpen(id: ScreenId): Promise<boolean> {
  const member = await currentMember();
  return !!member && opens(member, id);
}

export async function readTheme() {
  return parseTheme((await cookies()).get(themeCookie)?.value);
}

/**
 * Why the member's workspace takes no new work, as a page title and text: suspended (AIV-P2-037), waiting for approval
 * or not approved with the operator's reason (AIV-P2-039); null when it is active or there is no membership. Never
 * throws, so a 403 page can use it.
 */
export async function workspaceGate(): Promise<{ title: string; body: string } | null> {
  const status = (await currentMembership().catch(() => null))?.status;
  if (!status || status === 'active') return null;
  const t = await getTranslations(defaultLocale, defaultTimeZone);
  if (status === 'suspended') return { title: t('access.pausedTitle'), body: t('access.paused') };
  if (status === 'pending_approval') return { title: t('access.waitingTitle'), body: t('access.waiting') };
  const reason = (await rejectionReason().catch(() => null)) ?? '';
  return { title: t('access.rejectedTitle'), body: t('access.rejected', { reason }) };
}
