import type { Capability, ScreenId } from './navigation.ts';

export type Member = {
  name: string;
  initials: string;
  capabilities: readonly Capability[];
  workspace: { name: string; synthetic: boolean };
};

/** Sidebar badges; a section without a number shows no badge. */
export type ShellCounts = Partial<Record<ScreenId, number>>;

export type Theme = 'light' | 'dark';
export const themeCookie = 'theme';
/** Anything but "dark" is light, so a tampered cookie cannot put another value into data-theme. */
export const parseTheme = (value: unknown): Theme => (value === 'dark' ? 'dark' : 'light');
