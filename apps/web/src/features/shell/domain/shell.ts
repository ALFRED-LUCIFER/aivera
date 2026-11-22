import type { Role, WorkspaceStatus } from '@credalent/workspaces';
import type { Capability } from './navigation.ts';

export type Member = {
  name: string;
  initials: string;
  capabilities: readonly Capability[];
  workspace: { synthetic: boolean; status: WorkspaceStatus };
};

/**
 * The shell's view of a member. Everyone opens the desk and the jobs they are granted; only admins and recruiters get
 * the other recruiter screens. The server still authorises every action (job.view and the job grants decide).
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
  const capabilities: Capability[] = role === 'admin' || role === 'recruiter' ? ['member', 'recruiter'] : ['member'];
  return { name, initials: initials(name), capabilities, workspace: { synthetic, status } };
}

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
