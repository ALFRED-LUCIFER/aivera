import { usePathname } from 'next/navigation';
import { useCallback, useState } from 'react';

export function useCandidateShellController() {
  const [menuOpen, setMenuOpen] = useState(false);
  return {
    pathname: usePathname(),
    menuOpen,
    onToggleMenu: () => setMenuOpen((open) => !open),
    // Stable, so the shell's Escape listener is not re-attached on every render.
    onCloseMenu: useCallback(() => setMenuOpen(false), []),
  };
}
