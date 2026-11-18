import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { canOpen, navigation, type ScreenId } from '../domain/navigation.ts';
import { parseTheme, themeCookie, type Member, type ShellCounts } from '../domain/shell.ts';

// shortcut: no sign-in yet, so development renders as the synthetic recruiter "AP" in workspace "Demo"
// (docs/00-product/personas.md) and production renders no recruiter page at all. AIV-P0-010 replaces this with the
// Entra session.
export function devStandInMember(): Member | null {
  if (process.env.NODE_ENV === 'production') return null;
  return { name: 'AP', initials: 'AP', capabilities: ['recruiter'], workspace: { name: 'Demo', synthetic: true } };
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

// shortcut: seeded counts for the synthetic demo workspace; each section's module contract supplies its count when
// that screen's ticket ships.
const seedCounts = async (): Promise<ShellCounts> => ({ desk: 4, inbox: 20, jobs: 5, interviews: 5, packs: 1 });

/** Counts are a hint: a failed read shows the sections without numbers instead of blocking the page. */
export async function loadShellCounts(read = seedCounts): Promise<ShellCounts | null> {
  try {
    return await read();
  } catch {
    return null;
  }
}
