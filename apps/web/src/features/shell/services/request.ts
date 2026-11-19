import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { enabledFlags } from '@/server/flags';
import { currentMembership } from '@/server/workspace';
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
const seedCounts = async (): Promise<ShellCounts> => ({ desk: 4, inbox: 20, jobs: 5, interviews: 5, packs: 1 });

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
