import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { activeScreen } from '../domain/navigation.ts';
import type { Theme } from '../domain/shell.ts';
import { setTheme } from '../services/theme.ts';

export function useShellController(initialTheme: Theme) {
  const [navOpen, setNavOpen] = useState(false);
  const [theme, setThemeState] = useState(initialTheme);
  return {
    activeId: activeScreen(usePathname()),
    navOpen,
    onToggleNav: () => setNavOpen((open) => !open),
    onNavigate: () => setNavOpen(false),
    theme,
    onToggleTheme: () => {
      const next = theme === 'dark' ? 'light' : 'dark';
      setThemeState(next);
      document.documentElement.dataset['theme'] = next;
      void setTheme(next);
    },
    onAssistantOpenChange: (open: boolean) => {
      // shortcut: the shared drawer focuses its close button on open; the ticket wants the question field. Move this
      // into AssistantDrawer (onOpenAutoFocus) when packages/ui is free to change.
      if (open)
        setTimeout(() => document.querySelector<HTMLInputElement>('[role="dialog"] input[name="question"]')?.focus());
    },
  };
}
