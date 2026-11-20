import type { Role, WorkspaceStatus } from '@aivera/workspaces';
import type { Capability, ScreenId } from './navigation.ts';

export type Member = {
  name: string;
  initials: string;
  capabilities: readonly Capability[];
  workspace: { synthetic: boolean; status: WorkspaceStatus };
};

/**
 * The shell's view of a member. Admins and recruiters get the recruiter screens; hiring owners and interviewers get
 * none yet (their job-scoped screens come with their tickets). The server still authorises every action.
 */
export function shellMember({
  name,
  role,
  synthetic,
  status,
}: {
  name: string;
  role: Role;
  synthetic: boolean;
  status: WorkspaceStatus;
}): Member {
  const capabilities: Capability[] = role === 'admin' || role === 'recruiter' ? ['recruiter'] : [];
  return { name, initials: initials(name), capabilities, workspace: { synthetic, status } };
}

/** Sidebar badges; a section without a number shows no badge. */
export type ShellCounts = Partial<Record<ScreenId, number>>;

export type Theme = 'light' | 'dark';
export const themeCookie = 'theme';
/** Anything but "dark" is light, so a tampered cookie cannot put another value into data-theme. */
export const parseTheme = (value: unknown): Theme => (value === 'dark' ? 'dark' : 'light');

/** Up to two initials for an avatar disc: "Alex Recruiter" -> "AR". */
export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase())
    .join('');
