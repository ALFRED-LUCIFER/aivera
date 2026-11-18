import type { Theme } from '../domain/shell.ts';

/** Switches the page at once; the cookie (setTheme) makes it stick for the next server render. */
export const applyTheme = (theme: Theme) => {
  document.documentElement.dataset['theme'] = theme;
};
