import type { Theme } from '../domain/shell.ts';

/** Switches the page at once; the cookie (setTheme) makes it stick for the next server render. */
export const applyTheme = (theme: Theme) => {
  document.documentElement.dataset['theme'] = theme;
};

// shortcut: the shared AssistantDrawer focuses its close button on open, and the shell wants the question field.
// AIV-P0-903 (#221) moves this into AssistantDrawer's onOpenAutoFocus and deletes this function.
export const focusAssistantQuestion = () =>
  setTimeout(() => document.querySelector<HTMLInputElement>('[role="dialog"] input[name="question"]')?.focus());
