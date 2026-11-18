// ADR-002 item 4: the one map of recruiter screens. The sidebar and requireScreen() read it; navigation.test.ts fails
// when an entry has no page or a page under /app has no entry.

export type Capability = 'recruiter';

export type Screen = {
  id: string;
  path: `/app${string}`;
  capability: Capability;
  /** A feature flag that must be on, or null. */
  flag: string | null;
};

// Every section is a placeholder page until its screen ticket replaces it (docs/01-design/screens.md).
export const navigation = [
  { id: 'desk', path: '/app', capability: 'recruiter', flag: null },
  { id: 'inbox', path: '/app/inbox', capability: 'recruiter', flag: null },
  { id: 'jobs', path: '/app/jobs', capability: 'recruiter', flag: null },
  { id: 'candidates', path: '/app/candidates', capability: 'recruiter', flag: null },
  { id: 'pool', path: '/app/pool', capability: 'recruiter', flag: null },
  { id: 'interviews', path: '/app/interviews', capability: 'recruiter', flag: null },
  { id: 'packs', path: '/app/packs', capability: 'recruiter', flag: null },
  { id: 'value', path: '/app/value', capability: 'recruiter', flag: null },
] as const satisfies readonly Screen[];

export type NavigationEntry = (typeof navigation)[number];
export type ScreenId = NavigationEntry['id'];

export const canOpen = (screen: Screen, capabilities: readonly Capability[], flags: ReadonlySet<string>) =>
  capabilities.includes(screen.capability) && (screen.flag === null || flags.has(screen.flag));

/** The section a path belongs to: the longest map path that is the path itself or a parent of it. */
export function activeScreen(pathname: string): ScreenId | undefined {
  return navigation
    .filter(({ path }) => pathname === path || pathname.startsWith(`${path}/`))
    .toSorted((a, b) => b.path.length - a.path.length)[0]?.id;
}
