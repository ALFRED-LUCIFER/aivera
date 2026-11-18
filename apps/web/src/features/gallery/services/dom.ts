/** The gallery's theme toggle switches the whole page, like the shell's theme button. */
export const applyTheme = (theme: 'light' | 'dark') => {
  document.documentElement.dataset['theme'] = theme;
};
