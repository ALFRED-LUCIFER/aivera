import { usePathname } from 'next/navigation';
import { useCallback, useState } from 'react';
import { activeScreen } from '../domain/navigation.ts';
import type { Theme } from '../domain/shell.ts';
import { applyTheme, focusAssistantQuestion } from '../services/dom.ts';
import { setTheme } from '../services/theme.ts';

export function useShellController(initialTheme: Theme) {
  const [navOpen, setNavOpen] = useState(false);
  const [theme, setThemeState] = useState(initialTheme);
  const showTheme = (value: Theme) => {
    setThemeState(value);
    applyTheme(value);
  };
  return {
    activeId: activeScreen(usePathname()),
    navOpen,
    onToggleNav: () => setNavOpen((open) => !open),
    // Stable, so the shell's Escape listener is not re-attached on every render.
    onCloseNav: useCallback(() => setNavOpen(false), []),
    theme,
    onToggleTheme: () => {
      const next = theme === 'dark' ? 'light' : 'dark';
      showTheme(next);
      // Not saved means not switched: put the page back rather than show a theme the next load will drop.
      setTheme(next).catch(() => showTheme(theme));
    },
    onAssistantOpenChange: (open: boolean) => {
      if (open) focusAssistantQuestion();
    },
  };
}
