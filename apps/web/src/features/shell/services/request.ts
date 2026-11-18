import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { canOpen, navigation, type ScreenId } from '../domain/navigation.ts';
import { parseTheme, themeCookie, type Member, type ShellCounts } from '../domain/shell.ts';

// shortcut: no sign-in yet, so `next dev` renders as the synthetic recruiter "AP" in the synthetic demo workspace
// (docs/00-product/personas.md); every other environment renders no recruiter page at all. AIV-P0-010 replaces this
// with the Entra session.
export function devStandInMember(): Member | null {
  if (process.env.NODE_ENV !== 'development') return null;
  return { name: 'AP', initials: 'AP', capabilities: ['recruiter'], workspace: { synthetic: true } };
}

// shortcut: no feature flags exist yet; every map entry has flag null. The flag service supplies this set when it ships.
export const enabledFlags: ReadonlySet<string> = new Set();

/** The route guard every recruiter page awaits: no member, no capability or flag off is a 404. */
export async function requireScreen(id: ScreenId): Promise<Member> {
  const member = devStandInMember();
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
