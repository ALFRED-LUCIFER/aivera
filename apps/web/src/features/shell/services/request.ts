import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { enabledFlags } from '@/server/flags';
import { defaultLocale, defaultTimeZone, getTranslations } from '@credalent/i18n';
import { currentMembership, rejectionReason } from '@/server/workspace';
import { canOpen, navigation, type ScreenId } from '../domain/navigation.ts';
import { parseTheme, shellMember, themeCookie, type Member, type ShellCounts } from '../domain/shell.ts';

/**
 * The signed-in member in their active workspace. Null when they belong to no workspace yet; a removed member gets
 * the 403 page and no session goes to sign-in (AIV-P0-010).
 */
export async function currentMember(): Promise<Member | null> {
  const membership = await currentMembership();
  return membership && shellMember(membership);
}

/** The route guard every recruiter page awaits: no member, no capability or flag off is a 404. */
export async function requireScreen(id: ScreenId): Promise<Member> {
  const member = await currentMember();
  const screen = navigation.find((s) => s.id === id);
  if (!member || !screen || !canOpen(screen, member.capabilities, enabledFlags)) notFound();
  return member;
}

export async function readTheme() {
  return parseTheme((await cookies()).get(themeCookie)?.value);
}

// shortcut: seeded counts for the synthetic demo workspace only; each section's module contract supplies real counts
// when that screen's ticket ships.
const seedCounts = async (): Promise<ShellCounts> => ({ desk: 4, jobs: 5 });

/** Counts are a hint: a failed read shows the sections without numbers instead of blocking the page. */
export async function loadShellCounts(member: Member, read = seedCounts): Promise<ShellCounts | null> {
  // Never an invented number for a real workspace (AGENTS.md 1.7): no source yet means no badge.
  if (!member.workspace.synthetic) return null;
  try {
    return await read();
  } catch {
    return null;
  }
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
